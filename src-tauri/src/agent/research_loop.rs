use crate::{AppError, CompletionEvent};
use super::agent_loop::{project_dir, AgentLoopParams};
use super::executor::execute_tool;
use tokio_util::sync::CancellationToken;

/// Sends one prompt to whichever provider the research session is using and returns
/// the plain-text reply. Unlike `run_agent_loop`, this never offers tools — it's only
/// used for the synthesis/decision steps between search rounds.
async fn call_llm_once(
    provider: &str,
    http_client: &reqwest::Client,
    host: &str,
    api_key: &str,
    model: &str,
    cancel_token: &CancellationToken,
    prompt: &str,
) -> Result<String, AppError> {
    let messages = vec![crate::commands::ai::Message {
        role: "user".to_string(),
        content: prompt.to_string(),
        thinking: None,
        images: Vec::new(),
        tool_calls: Vec::new(),
        tool_name: None,
    }];
    match provider {
        "openai" => crate::commands::ai_providers::chat_completion_openai(
            http_client, api_key, model, &messages, false, None, cancel_token,
        ).await,
        "claude" => crate::commands::ai_providers::chat_completion_claude(
            http_client, api_key, model, &messages, false, None, cancel_token,
        ).await,
        _ => {
            let ollama = crate::commands::ai_ollama::build_ollama_client(host, api_key)?;
            let request = ollama_rs::generation::chat::request::ChatMessageRequest::new(
                model.to_string(),
                vec![ollama_rs::generation::chat::ChatMessage::user(prompt.to_string())],
            );
            let response = ollama.send_chat_messages(request).await
                .map_err(|e| AppError::Http(e.to_string()))?;
            Ok(response.message.content)
        }
    }
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

/// Asks the model for 3-4 search queries (plain JSON, no tools) for this round —
/// mirrors Odysseus's QUERY_GEN_PROMPT step.
fn build_query_gen_prompt(topic: &str, round: u8, max_rounds: u8, current_report: &str) -> String {
    if current_report.is_empty() {
        format!(
            "Research topic:\n{topic}\n\nThis is round {round} of {max_rounds}. Generate 3-4 \
            diverse, specific web search queries covering different angles of this topic.\n\n\
            Reply with ONLY JSON, no commentary: {{\"queries\": [\"...\", \"...\"]}}"
        )
    } else {
        format!(
            "Research topic:\n{topic}\n\nRound {round} of {max_rounds}. Current report:\n\
            {current_report}\n\nGenerate 3-4 web search queries that fill gaps in, verify, or \
            extend the report above.\n\nReply with ONLY JSON, no commentary: \
            {{\"queries\": [\"...\", \"...\"]}}"
        )
    }
}

fn parse_queries(reply: &str) -> Vec<String> {
    #[derive(serde::Deserialize)]
    struct QueryList { queries: Vec<String> }

    let cleaned = reply.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```");
    serde_json::from_str::<QueryList>(cleaned.trim()).map(|q| q.queries).unwrap_or_default()
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
async fn run_search_round(
    params: &AgentLoopParams<'_>,
    query_gen_prompt: &str,
    round: u8,
    max_rounds: u8,
    sources: &mut u32,
) -> Result<String, AppError> {
    let reply = call_llm_once(
        params.provider, params.http_client, params.host, params.api_key, params.model,
        params.cancel_token, query_gen_prompt,
    ).await?;
    let queries = parse_queries(&reply);
    if queries.is_empty() {
        return Ok(String::new());
    }

    let proj_dir = project_dir(params.app_data_dir, params.output_path);
    let mut findings = Vec::new();
    for query in queries.iter().take(4) {
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
            continue;
        }
        let urls: Vec<&str> = search_res.output.lines()
            .filter_map(|l| l.trim().strip_prefix("URL: "))
            .take(2)
            .collect();
        for url in urls {
            let _ = params.channel.send(CompletionEvent::ResearchPhase {
                phase: "fetching".into(), round, max_rounds,
                detail: Some(url.to_string()), sources: *sources,
            });

            let fetch_args = serde_json::json!({
                "url": url,
                "prompt": format!("Extract information relevant to: {query}"),
            });
            let fetch_res = execute_tool(
                "web_fetch", &fetch_args, params.app_data_dir, params.output_path, &proj_dir,
                params.permission_mode, params.http_client, &params.searxng_url, params.app_handle,
            ).await;
            if fetch_res.success {
                if let Ok(notes) = extract_relevant(params, query, &fetch_res.output).await {
                    *sources += 1;
                    findings.push(format!("[{url}]\n{notes}"));
                    let _ = params.channel.send(CompletionEvent::ResearchPhase {
                        phase: "fetching".into(), round, max_rounds,
                        detail: Some(url.to_string()), sources: *sources,
                    });
                }
            }
        }
        findings.push(search_res.output);
    }
    Ok(findings.join("\n\n---\n\n"))
}

async fn synthesize_round(
    provider: &str,
    http_client: &reqwest::Client,
    host: &str,
    api_key: &str,
    model: &str,
    cancel_token: &CancellationToken,
    current_report: &str,
    new_findings: &str,
    round: u8,
) -> Result<String, AppError> {
    let prompt = if current_report.is_empty() {
        format!(
            "Round {} of the research session. Based on the search/fetch findings below, produce \
            an initial research report summarizing what you have found so far. Use clear ## \
            headings, include source citations, and note where sources agree or disagree.\n\n\
            Findings:\n{}",
            round, new_findings
        )
    } else {
        format!(
            "Round {} complete. Update this research report by integrating the new findings \
            below.\n\nCurrent report:\n{}\n\nNew findings from this round:\n{}\n\n\
            Produce an updated, well-organized report. Remove redundancy, resolve contradictions, \
            maintain logical flow. Keep source URLs as inline citations.",
            round, current_report, new_findings
        )
    };

    call_llm_once(provider, http_client, host, api_key, model, cancel_token, &prompt).await
}

async fn should_stop(
    provider: &str,
    http_client: &reqwest::Client,
    host: &str,
    api_key: &str,
    model: &str,
    cancel_token: &CancellationToken,
    report: &str,
) -> Result<bool, AppError> {
    let mut cut = report.len().min(2000);
    while !report.is_char_boundary(cut) { cut -= 1; }
    let prompt = format!(
        "Based on this research report, should we stop researching? \
        Reply with ONLY YES or NO followed by a brief one-sentence reason.\n\n{}",
        &report[..cut]
    );

    let reply = call_llm_once(provider, http_client, host, api_key, model, cancel_token, &prompt).await?;
    Ok(reply.trim().to_uppercase().starts_with("YES"))
}

async fn write_final_report(
    provider: &str,
    http_client: &reqwest::Client,
    host: &str,
    api_key: &str,
    model: &str,
    cancel_token: &CancellationToken,
    report: &str,
) -> Result<String, AppError> {
    let prompt = format!(
        "Write a **long, detailed, comprehensive** research report based on the findings below.\n\n\
        Requirements:\n\
        - Write at MINIMUM 1500 words — this should be a thorough, magazine-quality article\n\
        - Use clear ## headings and ### subheadings to organize into logical sections\n\
        - Each section should have multiple detailed paragraphs, not just bullet points\n\
        - Synthesize and analyze the information — explain WHY things matter, draw comparisons, provide context\n\
        - Include specific data points, numbers, and statistics from the evidence\n\
        - Include source URLs as inline citations [like this](url)\n\
        - Note where sources agree and where they disagree\n\
        - Add a brief executive summary at the top\n\
        - End with a clear conclusion that directly answers the question\n\
        - Write in an engaging, informative style — not dry or robotic\n\n\
        Findings:\n{}",
        report
    );

    call_llm_once(provider, http_client, host, api_key, model, cancel_token, &prompt).await
}

pub async fn run_research_loop(
    params: AgentLoopParams<'_>,
    config: ResearchLoopConfig,
    initial_system_prompt: String,
) -> Result<(), AppError> {
    let config = config.clamped();
    let start = std::time::Instant::now();
    let mut round: u8 = 0;
    let mut empty_rounds: u8 = 0;
    let mut report_body = String::new();
    let mut sources: u32 = 0;

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

        let query_gen_prompt = build_query_gen_prompt(
            &initial_system_prompt,
            round,
            config.max_rounds,
            &report_body,
        );

        let new_findings = run_search_round(&params, &query_gen_prompt, round, config.max_rounds, &mut sources).await?;

        if new_findings.trim().is_empty() {
            empty_rounds += 1;
            if empty_rounds >= config.max_empty_rounds {
                break;
            }
        } else {
            empty_rounds = 0;
        }

        let _ = params.channel.send(CompletionEvent::ResearchPhase {
            phase: "synthesizing".into(),
            round,
            max_rounds: config.max_rounds,
            detail: None,
            sources,
        });

        report_body = synthesize_round(
            params.provider,
            params.http_client,
            params.host,
            params.api_key,
            params.model,
            params.cancel_token,
            &report_body,
            &new_findings,
            round,
        ).await?;
        // Hard ceiling regardless of how well the model followed "remove redundancy" above —
        // a single oversized round must not be allowed to carry forward into every subsequent prompt.
        if report_body.len() > 12_000 {
            let mut cut = 12_000;
            while !report_body.is_char_boundary(cut) { cut -= 1; }
            report_body.truncate(cut);
        }

        if round >= config.min_rounds {
            let _ = params.channel.send(CompletionEvent::ResearchPhase {
                phase: "deciding".into(),
                round,
                max_rounds: config.max_rounds,
                detail: None,
                sources,
            });

            if should_stop(
                params.provider,
                params.http_client,
                params.host,
                params.api_key,
                params.model,
                params.cancel_token,
                &report_body,
            ).await? {
                break;
            }
        }
    }

    let _ = params.channel.send(CompletionEvent::ResearchPhase {
        phase: "final_report".into(),
        round,
        max_rounds: config.max_rounds,
        detail: None,
        sources,
    });

    let final_report = write_final_report(
        params.provider,
        params.http_client,
        params.host,
        params.api_key,
        params.model,
        params.cancel_token,
        &report_body,
    ).await?;

    let _ = params.channel.send(CompletionEvent::Chunk {
        text: final_report,
        thinking: None,
    });

    let _ = params.channel.send(CompletionEvent::Done {
        done_reason: Some("research_complete".into()),
        usage: None,
    });

    Ok(())
}
