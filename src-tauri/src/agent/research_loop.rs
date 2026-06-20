use crate::{AppError, CompletionEvent};
use super::agent_loop::{project_dir, AgentLoopParams};
use super::executor::execute_tool;
use super::research_prompts::{
    build_category_prompt, build_final_report_prompt, build_plan_prompt, build_query_gen_prompt,
    build_stop_prompt, build_synthesize_prompt, is_low_quality, parse_category, parse_plan,
    parse_queries, parse_search_results, parse_stop_decision, ResearchPlan, EXPANSION_REQUEST,
    MIN_FINAL_REPORT_WORDS,
};
use super::research_report::{format_research_report, Finding, ResearchStats};
use tokio_util::sync::CancellationToken;

/// How many of the most-recent findings are re-fed into synthesis each round —
/// mirrors Odysseus's `synthesis_window` (older findings still count as sources,
/// they just drop out of the synthesis prompt).
const SYNTHESIS_WINDOW: usize = 10;

fn user_msg(content: impl Into<String>) -> crate::commands::ai::Message {
    crate::commands::ai::Message {
        role: "user".to_string(), content: content.into(), thinking: None,
        images: Vec::new(), tool_calls: Vec::new(), tool_name: None,
    }
}

fn assistant_msg(content: impl Into<String>) -> crate::commands::ai::Message {
    crate::commands::ai::Message {
        role: "assistant".to_string(), content: content.into(), thinking: None,
        images: Vec::new(), tool_calls: Vec::new(), tool_name: None,
    }
}

/// Sends a multi-turn message list to whichever provider the research session is using
/// and returns the plain-text reply. Unlike `run_agent_loop`, this never offers tools —
/// it's only used for the planning/synthesis/decision steps between search rounds.
async fn call_llm_messages(
    provider: &str,
    http_client: &reqwest::Client,
    host: &str,
    api_key: &str,
    model: &str,
    cancel_token: &CancellationToken,
    messages: Vec<crate::commands::ai::Message>,
) -> Result<String, AppError> {
    match provider {
        "openai" => crate::commands::ai_providers::chat_completion_openai(
            http_client, api_key, model, &messages, false, None, cancel_token,
        ).await,
        "claude" => crate::commands::ai_providers::chat_completion_claude(
            http_client, api_key, model, &messages, false, None, cancel_token,
        ).await,
        _ => {
            let ollama = crate::commands::ai_ollama::build_ollama_client(host, api_key)?;
            let chat_messages: Vec<ollama_rs::generation::chat::ChatMessage> = messages.iter()
                .map(|m| match m.role.as_str() {
                    "assistant" => ollama_rs::generation::chat::ChatMessage::assistant(m.content.clone()),
                    _ => ollama_rs::generation::chat::ChatMessage::user(m.content.clone()),
                })
                .collect();
            let request = ollama_rs::generation::chat::request::ChatMessageRequest::new(model.to_string(), chat_messages);
            let response = ollama.send_chat_messages(request).await
                .map_err(|e| AppError::Http(e.to_string()))?;
            Ok(response.message.content)
        }
    }
}

async fn call_llm_once(
    provider: &str,
    http_client: &reqwest::Client,
    host: &str,
    api_key: &str,
    model: &str,
    cancel_token: &CancellationToken,
    prompt: &str,
) -> Result<String, AppError> {
    call_llm_messages(provider, http_client, host, api_key, model, cancel_token, vec![user_msg(prompt)]).await
}

/// Configuration for one multi-turn research session.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ResearchLoopConfig {
    /// Maximum number of research rounds. Odysseus default: 8.
    #[serde(default = "default_max_rounds")]
    pub max_rounds: u8,
    /// Wall-clock timeout in seconds. Odysseus default: 300.
    #[serde(default = "default_max_time_secs")]
    pub max_time_secs: u64,
    /// Minimum rounds before early-stop is evaluated. Odysseus default: 2.
    #[serde(default = "default_min_rounds")]
    pub min_rounds: u8,
    /// Abort after this many consecutive empty rounds. Odysseus default: 2.
    #[serde(default = "default_max_empty_rounds")]
    pub max_empty_rounds: u8,
}

fn default_max_rounds() -> u8 { 8 }
fn default_max_time_secs() -> u64 { 300 }
fn default_min_rounds() -> u8 { 2 }
fn default_max_empty_rounds() -> u8 { 2 }

impl Default for ResearchLoopConfig {
    fn default() -> Self {
        Self {
            max_rounds: default_max_rounds(),
            max_time_secs: default_max_time_secs(),
            min_rounds: default_min_rounds(),
            max_empty_rounds: default_max_empty_rounds(),
        }
    }
}

impl ResearchLoopConfig {
    pub fn clamped(mut self) -> Self {
        self.max_rounds = self.max_rounds.clamp(1, 20);
        self.max_time_secs = self.max_time_secs.clamp(30, 1800);
        self.min_rounds = self.min_rounds.clamp(1, 20);
        self.max_empty_rounds = self.max_empty_rounds.clamp(1, 10);
        self
    }
}

/// Raw fetched pages have no size cap (`execute_web_fetch` returns the page as-is) and
/// can run hundreds of KB — feeding that straight into the report blows the context
/// window within a couple of rounds. Odysseus's EXTRACT phase exists for exactly this:
/// a per-URL LLM call that compresses a fetch into only the notes relevant to the query
/// before it's allowed anywhere near the running report.
async fn extract_relevant(params: &AgentLoopParams<'_>, query: &str, raw_content: &str) -> Result<String, AppError> {
    let mut cut = raw_content.len().min(20_000);
    while !raw_content.is_char_boundary(cut) { cut -= 1; }
    let capped = &raw_content[..cut];
    let prompt = format!(
        "Extract only the facts relevant to this query as concise notes (a few sentences to a \
        short paragraph). Discard boilerplate, navigation, and unrelated content. Keep numbers, \
        dates, and names exact.\n\nQuery: {query}\n\nPage content:\n{capped}"
    );
    call_llm_once(
        params.provider, params.http_client, params.host, params.api_key, params.model,
        params.cancel_token, &prompt,
    ).await
}

/// Runs one research round: generates queries via a single plain LLM call, then
/// executes web_search/web_fetch directly (no agentic tool-calling, no deferred-tool
/// schema resolution) — control flow lives here in Rust, same as Odysseus's Python loop.
/// Emits a `ResearchPhase` event for every query/fetch so the frontend never sits idle
/// for the whole round without feedback. `sources` is the running cross-round count.
/// Findings whose extraction reads as low-quality (boilerplate/empty/irrelevant) are
/// dropped before they reach the caller, mirroring Odysseus's `is_low_quality` filter.
async fn run_search_round(
    params: &AgentLoopParams<'_>,
    query_gen_prompt: &str,
    round: u8,
    max_rounds: u8,
    sources: &mut u32,
    queries_used: &mut u32,
    analyzed_urls: &mut Vec<(String, String)>,
    last_search_error: &mut Option<String>,
) -> Result<Vec<Finding>, AppError> {
    let reply = call_llm_once(
        params.provider, params.http_client, params.host, params.api_key, params.model,
        params.cancel_token, query_gen_prompt,
    ).await?;
    let queries = parse_queries(&reply);
    if queries.is_empty() {
        return Ok(Vec::new());
    }

    let proj_dir = project_dir(params.app_data_dir, params.output_path);
    let mut findings = Vec::new();
    for query in queries.iter().take(4) {
        *queries_used += 1;
        let _ = params.channel.send(CompletionEvent::ResearchPhase {
            phase: "searching".into(), round, max_rounds,
            detail: Some(query.clone()), sources: *sources,
        });

        let search_args = serde_json::json!({ "query": query, "num_results": 5 });
        let search_res = execute_tool(
            "web_search", &search_args, params.app_data_dir, params.output_path, &proj_dir,
            params.permission_mode, params.http_client, &params.searxng_url, params.app_handle,
        ).await;
        if !search_res.success {
            *last_search_error = Some(search_res.output.clone());
            continue;
        }

        for (title, url) in parse_search_results(&search_res.output).into_iter().take(2) {
            analyzed_urls.push((url.clone(), title.clone()));
            let _ = params.channel.send(CompletionEvent::ResearchPhase {
                phase: "fetching".into(), round, max_rounds,
                detail: Some(url.clone()), sources: *sources,
            });

            let fetch_args = serde_json::json!({
                "url": url,
                "prompt": format!("Extract information relevant to: {query}"),
            });
            let fetch_res = execute_tool(
                "web_fetch", &fetch_args, params.app_data_dir, params.output_path, &proj_dir,
                params.permission_mode, params.http_client, &params.searxng_url, params.app_handle,
            ).await;
            if !fetch_res.success {
                *last_search_error = Some(fetch_res.output.clone());
                continue;
            }

            if let Ok(notes) = extract_relevant(params, query, &fetch_res.output).await {
                if !is_low_quality(&notes) {
                    *sources += 1;
                    findings.push(Finding { url: url.clone(), title: title.clone(), notes });
                    let _ = params.channel.send(CompletionEvent::ResearchPhase {
                        phase: "fetching".into(), round, max_rounds,
                        detail: Some(url.clone()), sources: *sources,
                    });
                }
            }
        }
    }
    Ok(findings)
}

/// Integrates the latest findings into the evolving report. If synthesis itself fails
/// (timeout, provider error), keeps the previous report rather than losing the round's
/// work — mirrors Odysseus's `_synthesize` exception handler.
async fn synthesize_round(
    params: &AgentLoopParams<'_>,
    topic: &str,
    current_report: &str,
    findings_window: &[Finding],
    round: u8,
    max_rounds: u8,
    sources: u32,
) -> String {
    let findings_text = findings_window.iter()
        .map(|f| format!("[{}]({})\n{}", f.title, f.url, f.notes))
        .collect::<Vec<_>>()
        .join("\n\n---\n\n");
    let prompt = build_synthesize_prompt(topic, current_report, &findings_text);

    match call_llm_once(
        params.provider, params.http_client, params.host, params.api_key, params.model,
        params.cancel_token, &prompt,
    ).await {
        Ok(report) => report,
        Err(_) => {
            let _ = params.channel.send(CompletionEvent::ResearchPhase {
                phase: "synthesizing".into(), round, max_rounds,
                detail: Some("Synthesis failed — keeping previous report".into()), sources,
            });
            current_report.to_string()
        }
    }
}

async fn should_stop(
    provider: &str,
    http_client: &reqwest::Client,
    host: &str,
    api_key: &str,
    model: &str,
    cancel_token: &CancellationToken,
    report: &str,
    sub_questions: &[String],
    round: u8,
    max_rounds: u8,
) -> Result<bool, AppError> {
    let prompt = build_stop_prompt(report, sub_questions, round, max_rounds);
    let reply = call_llm_once(provider, http_client, host, api_key, model, cancel_token, &prompt).await?;
    Ok(parse_stop_decision(&reply))
}

/// Writes the polished final report, retrying once with an explicit expansion request
/// if the model comes back under `MIN_FINAL_REPORT_WORDS` — mirrors Odysseus's `_final_report`.
async fn write_final_report(
    params: &AgentLoopParams<'_>,
    topic: &str,
    report: &str,
    category: Option<&str>,
) -> Result<String, AppError> {
    let prompt = build_final_report_prompt(topic, report, category);
    let result = call_llm_once(
        params.provider, params.http_client, params.host, params.api_key, params.model,
        params.cancel_token, &prompt,
    ).await?;

    if result.split_whitespace().count() < MIN_FINAL_REPORT_WORDS {
        let messages = vec![user_msg(prompt), assistant_msg(result.clone()), user_msg(EXPANSION_REQUEST)];
        if let Ok(expanded) = call_llm_messages(
            params.provider, params.http_client, params.host, params.api_key, params.model,
            params.cancel_token, messages,
        ).await {
            if expanded.split_whitespace().count() > result.split_whitespace().count() {
                return Ok(expanded);
            }
        }
    }

    Ok(result)
}

pub async fn run_research_loop(
    params: AgentLoopParams<'_>,
    config: ResearchLoopConfig,
    topic: String,
) -> Result<(), AppError> {
    let config = config.clamped();
    let start = std::time::Instant::now();
    let mut round: u8 = 0;
    let mut empty_rounds: u8 = 0;
    let mut report_body = String::new();
    let mut sources: u32 = 0;
    let mut queries_used: u32 = 0;
    let mut all_findings: Vec<Finding> = Vec::new();
    let mut analyzed_urls: Vec<(String, String)> = Vec::new();
    let mut last_search_error: Option<String> = None;
    let mut search_unavailable = false;

    // PLAN + category classification — run once, up front, like Odysseus's
    // `_create_plan`/`_classify_category`. Failures here just fall back to no
    // plan/no category rather than aborting the whole session.
    let _ = params.channel.send(CompletionEvent::ResearchPhase {
        phase: "planning".into(), round: 0, max_rounds: config.max_rounds, detail: None, sources: 0,
    });
    let plan = call_llm_once(
        params.provider, params.http_client, params.host, params.api_key, params.model,
        params.cancel_token, &build_plan_prompt(&topic),
    ).await.map(|reply| parse_plan(&reply)).unwrap_or(ResearchPlan { summary: String::new(), sub_questions: Vec::new() });
    let category = call_llm_once(
        params.provider, params.http_client, params.host, params.api_key, params.model,
        params.cancel_token, &build_category_prompt(&topic),
    ).await.ok().and_then(|reply| parse_category(&reply));

    loop {
        if params.cancel_token.is_cancelled() {
            let _ = params.channel.send(CompletionEvent::Done { done_reason: None, usage: None });
            return Ok(());
        }
        if start.elapsed().as_secs() >= config.max_time_secs {
            break;
        }
        if round >= config.max_rounds {
            break;
        }
        round += 1;

        let _ = params.channel.send(CompletionEvent::ResearchPhase {
            phase: "round_start".into(),
            round,
            max_rounds: config.max_rounds,
            detail: None,
            sources,
        });

        let query_gen_prompt = build_query_gen_prompt(&topic, &plan.summary, round, config.max_rounds, &report_body);

        let round_findings = run_search_round(
            &params, &query_gen_prompt, round, config.max_rounds,
            &mut sources, &mut queries_used, &mut analyzed_urls, &mut last_search_error,
        ).await?;

        if round_findings.is_empty() {
            empty_rounds += 1;
            if empty_rounds >= config.max_empty_rounds {
                if all_findings.is_empty() {
                    search_unavailable = true;
                }
                break;
            }
        } else {
            empty_rounds = 0;
            all_findings.extend(round_findings);
        }

        let _ = params.channel.send(CompletionEvent::ResearchPhase {
            phase: "synthesizing".into(),
            round,
            max_rounds: config.max_rounds,
            detail: None,
            sources,
        });

        // Re-feed only the most recent findings into synthesis, not the whole
        // history — bounds prompt growth while older findings still count as
        // sources in the final report. Mirrors Odysseus's `synthesis_window`.
        let window_start = all_findings.len().saturating_sub(SYNTHESIS_WINDOW);
        report_body = synthesize_round(
            &params, &topic, &report_body, &all_findings[window_start..], round, config.max_rounds, sources,
        ).await;

        // Hard floor: don't even ask the model to stop until findings cover the
        // plan's scope (one finding per sub-question) — otherwise it can stop on
        // sentiment alone before there's enough evidence to judge coverage.
        let evidence_floor = plan.sub_questions.is_empty() || all_findings.len() >= plan.sub_questions.len();
        if round >= config.min_rounds && evidence_floor {
            let _ = params.channel.send(CompletionEvent::ResearchPhase {
                phase: "deciding".into(),
                round,
                max_rounds: config.max_rounds,
                detail: None,
                sources,
            });

            if should_stop(
                params.provider, params.http_client, params.host, params.api_key, params.model,
                params.cancel_token, &report_body, &plan.sub_questions, round, config.max_rounds,
            ).await? {
                break;
            }
        }
    }

    if search_unavailable {
        let detail = last_search_error.unwrap_or_else(|| "unknown error".into());
        let message = format!(
            "**Search unavailable** — Web search failed after {round} round(s). Error: {detail}\n\n\
            Please check your search provider settings and ensure the service is running."
        );
        let _ = params.channel.send(CompletionEvent::Chunk { text: message, thinking: None });
        let _ = params.channel.send(CompletionEvent::Done {
            done_reason: Some("search_unavailable".into()),
            usage: None,
        });
        return Ok(());
    }

    let _ = params.channel.send(CompletionEvent::ResearchPhase {
        phase: "final_report".into(),
        round,
        max_rounds: config.max_rounds,
        detail: None,
        sources,
    });

    let final_report = if report_body.is_empty() {
        if all_findings.is_empty() {
            "No information could be gathered for this question.".to_string()
        } else {
            // Synthesis never produced a report despite findings being gathered (e.g. every
            // synthesize_round call failed) — fall back to a basic compiled listing instead
            // of claiming nothing was found.
            all_findings.iter()
                .map(|f| format!("## {}\n\n{}\n\nSource: {}", f.title, f.notes, f.url))
                .collect::<Vec<_>>()
                .join("\n\n")
        }
    } else {
        write_final_report(&params, &topic, &report_body, category.as_deref()).await?
    };

    let stats = ResearchStats {
        elapsed_secs: start.elapsed().as_secs_f64(),
        rounds: round,
        queries: queries_used,
        urls_analyzed: analyzed_urls.len(),
    };
    let formatted = format_research_report(&topic, &final_report, &stats, &all_findings, &analyzed_urls);

    let _ = params.channel.send(CompletionEvent::Chunk {
        text: formatted,
        thinking: None,
    });

    let _ = params.channel.send(CompletionEvent::Done {
        done_reason: Some("research_complete".into()),
        usage: None,
    });

    Ok(())
}
