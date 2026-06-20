//! Prompt templates and small text-parsing helpers for the research loop.
//! Mirrors Odysseus's `src/deep_research.py` prompt constants and
//! `src/research_utils.py::is_low_quality`.

/// Markers indicating an extracted finding is boilerplate, an error, or empty —
/// ported verbatim from Odysseus's `LOW_QUALITY_MARKERS`.
const LOW_QUALITY_MARKERS: [&str; 16] = [
    "insufficient to",
    "content is insufficient",
    "no substantive data",
    "does not contain",
    "not relevant to",
    "no relevant information",
    "unable to extract",
    "completely unrelated",
    "boilerplate",
    "footer text",
    "cookie consent",
    "cookie banner",
    "cookie notice",
    "copyright notice",
    "copyright footer",
    "all rights reserved",
];

/// True if a finding's notes read as useless (empty or matching a low-quality marker).
pub fn is_low_quality(notes: &str) -> bool {
    if notes.trim().is_empty() {
        return true;
    }
    let low = notes.to_lowercase();
    LOW_QUALITY_MARKERS.iter().any(|marker| low.contains(marker))
}

pub fn build_plan_prompt(topic: &str) -> String {
    format!(
        "You are a research strategist. Before searching, analyze this question and create a \
        research plan.\n\n**Question:** {topic}\n\nBreak this question down:\n\
        1. What are the key sub-topics that need to be covered for a comprehensive answer?\n\
        2. What specific data points, facts, or perspectives should we look for?\n\
        3. What would a complete, high-quality answer include?\n\n\
        Return a JSON object with:\n\
        - \"sub_questions\": Array of 3-6 specific sub-questions to investigate\n\
        - \"key_topics\": Array of key topics/angles to cover\n\
        - \"success_criteria\": One sentence describing what a complete answer looks like\n\n\
        Reply with ONLY JSON, no commentary."
    )
}

#[derive(serde::Deserialize)]
struct PlanResponse {
    sub_questions: Option<Vec<String>>,
    key_topics: Option<Vec<String>>,
    success_criteria: Option<String>,
}

pub struct ResearchPlan {
    pub summary: String,
    pub sub_questions: Vec<String>,
}

pub fn parse_plan(reply: &str) -> ResearchPlan {
    let cleaned = reply.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```");
    let Ok(plan) = serde_json::from_str::<PlanResponse>(cleaned.trim()) else {
        return ResearchPlan { summary: reply.trim().to_string(), sub_questions: Vec::new() };
    };
    let sub_questions = plan.sub_questions.unwrap_or_default();
    let mut parts = Vec::new();
    if !sub_questions.is_empty() {
        parts.push(format!("Sub-questions: {}", sub_questions.join("; ")));
    }
    if let Some(topics) = plan.key_topics.filter(|v| !v.is_empty()) {
        parts.push(format!("Key topics: {}", topics.join(", ")));
    }
    if let Some(criteria) = plan.success_criteria {
        parts.push(format!("Success: {criteria}"));
    }
    let summary = if parts.is_empty() { reply.trim().to_string() } else { parts.join("\n") };
    ResearchPlan { summary, sub_questions }
}

/// Valid category labels — keys of Odysseus's `CATEGORY_PROMPTS` plus the
/// "general" fallback (which has no format override).
const CATEGORIES: [&str; 5] = ["product", "comparison", "howto", "factcheck", "general"];

pub fn build_category_prompt(topic: &str) -> String {
    format!(
        "Classify this research question into exactly ONE category.\n\
        Categories: product, comparison, howto, factcheck, general\n\
        If none fit well, respond with: general\n\n\
        Question: {topic}\n\n\
        Respond with ONLY the category name, nothing else."
    )
}

/// Parses the category classifier's reply, tolerating a one-word answer or a
/// short sentence that merely contains the category word.
pub fn parse_category(reply: &str) -> Option<String> {
    let low = reply.trim().to_lowercase();
    let first = low.split_whitespace().next().unwrap_or("").trim_matches(|c: char| ".,\"'*:".contains(c));
    if CATEGORIES.contains(&first) {
        return Some(first.to_string());
    }
    CATEGORIES.iter().find(|c| low.contains(*c)).map(|s| s.to_string())
}

/// Final-report format override for a category — ported verbatim from Odysseus's
/// `CATEGORY_PROMPTS`. "general" (and unknown categories) get no override.
pub fn category_format_override(category: &str) -> Option<&'static str> {
    match category {
        "product" => Some(
            "IMPORTANT FORMAT OVERRIDE — this is a PRODUCT research report:\n\
            - Structure as a RANKED LIST of products/options (best first)\n\
            - For EACH product include: name as ### heading, approximate price, 2-3 sentence \
            summary, **Pros:** bullet list, **Cons:** bullet list, **Where to buy:** URLs as links\n\
            - Start with a quick-compare markdown table of top picks (columns: Name, Price, Best For, Rating)\n\
            - End with a ## Verdict section picking Best Overall and Best Value\n\
            - Still include source citations inline"
        ),
        "comparison" => Some(
            "IMPORTANT FORMAT OVERRIDE — this is a COMPARISON report:\n\
            - Create a ## Comparison Table as a markdown table comparing ALL options across key \
            criteria (rows = criteria, columns = options)\n\
            - Use checkmarks, ratings, or short values in cells\n\
            - Write a ## section per option with its strengths, weaknesses, and ideal use case\n\
            - End with ## Best For verdicts (e.g., \"**Best for small teams:** Option A because...\")\n\
            - Include a ## Shared Considerations section for things that apply to all options"
        ),
        "howto" => Some(
            "IMPORTANT FORMAT OVERRIDE — this is a HOW-TO guide:\n\
            - Start with ## Quick Guide — a super concise numbered list (one line per step, no \
            details, just the action). Example: 1. Install X  2. Run Y  3. Configure Z\n\
            - Then ## Prerequisites listing what's needed before starting\n\
            - Then the detailed steps: ## Step 1: ..., ## Step 2: ...\n\
            - Each step should have a clear heading and detailed instructions\n\
            - Use blockquotes (> ) for tips and warnings: > **Tip:** ... or > **Warning:** ...\n\
            - End with ## Common Mistakes section\n\
            - Add estimated time and difficulty level near the top"
        ),
        "factcheck" => Some(
            "IMPORTANT FORMAT OVERRIDE — this is a FACT-CHECK report:\n\
            - Start with ## The Claim restating what's being checked\n\
            - Create ## Evidence For and ## Evidence Against sections\n\
            - Each piece of evidence should be a ### with source name, what it found, and how \
            strong the evidence is\n\
            - Include a ## Verdict section with one of: **Supported**, **Mixed Evidence**, or **Unsupported**\n\
            - End with ## Nuance & Caveats for important context and limitations\n\
            - Be balanced and cite sources for every claim"
        ),
        _ => None,
    }
}

/// One search result line, e.g. "[1] Page Title" paired with the "URL: ..." line
/// that follows it in `web_search`'s formatted output (see executor.rs).
pub fn parse_search_results(output: &str) -> Vec<(String, String)> {
    let mut results = Vec::new();
    let mut pending_title: Option<String> = None;
    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("URL: ") {
            if let Some(title) = pending_title.take() {
                results.push((title, rest.to_string()));
            }
        } else if trimmed.starts_with('[') {
            if let Some(end) = trimmed.find(']') {
                pending_title = Some(trimmed[end + 1..].trim().to_string());
            }
        }
    }
    results
}

pub fn build_query_gen_prompt(topic: &str, research_plan: &str, round: u8, max_rounds: u8, current_report: &str) -> String {
    let plan_block = if research_plan.is_empty() { String::new() } else { format!("\n\nResearch plan:\n{research_plan}") };
    if current_report.is_empty() {
        format!(
            "Research topic:\n{topic}{plan_block}\n\nThis is round {round} of {max_rounds}. Generate 3-4 \
            diverse, specific web search queries covering different angles of this topic.\n\n\
            Reply with ONLY JSON, no commentary: {{\"queries\": [\"...\", \"...\"]}}"
        )
    } else {
        format!(
            "Research topic:\n{topic}{plan_block}\n\nRound {round} of {max_rounds}. Current report:\n\
            {current_report}\n\nGenerate 3-4 web search queries that fill gaps in, verify, or \
            extend the report above.\n\nReply with ONLY JSON, no commentary: \
            {{\"queries\": [\"...\", \"...\"]}}"
        )
    }
}

pub fn parse_queries(reply: &str) -> Vec<String> {
    #[derive(serde::Deserialize)]
    struct QueryList { queries: Vec<String> }

    let cleaned = reply.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```");
    serde_json::from_str::<QueryList>(cleaned.trim()).map(|q| q.queries).unwrap_or_default()
}

pub fn build_synthesize_prompt(topic: &str, current_report: &str, findings_window: &str) -> String {
    if current_report.is_empty() {
        format!(
            "You are updating an evolving research report.\n\nResearch topic:\n{topic}\n\n\
            Based on the search/fetch findings below, produce an initial research report \
            summarizing what you have found so far. Use clear ## headings, include source \
            citations, and note where sources agree or disagree.\n\nFindings:\n{findings_window}"
        )
    } else {
        format!(
            "You are updating an evolving research report.\n\nResearch topic:\n{topic}\n\n\
            Current report:\n{current_report}\n\nNew findings from this round:\n{findings_window}\n\n\
            Integrate the new findings into the existing report. Produce an updated, well-organized \
            report. Remove redundancy, resolve contradictions, maintain logical flow. Keep source \
            URLs as inline citations."
        )
    }
}

pub fn build_stop_prompt(report: &str, sub_questions: &[String], round: u8, max_rounds: u8) -> String {
    let checklist = if sub_questions.is_empty() {
        String::new()
    } else {
        let lines: Vec<String> = sub_questions.iter().enumerate()
            .map(|(i, q)| format!("{}. {q}", i + 1))
            .collect();
        format!("\n\n**Sub-questions to verify against the report:**\n{}", lines.join("\n"))
    };
    format!(
        "You are deciding whether a research report is comprehensive enough.\n\n\
        **Current report:**\n{report}{checklist}\n\n**Rounds completed:** {round} of {max_rounds}\n\n\
        For each sub-question above, check whether the report answers it with cited evidence. \
        If rounds completed is well below the target, prefer continuing unless the report is \
        already exhaustive.\n\n\
        Reply with ONLY JSON, no commentary: {{\"unanswered\": [\"...\"], \"stop\": true|false}}\n\
        \"unanswered\" must list the exact text of any sub-question above not yet answered with \
        evidence — leave it empty if all are covered, or if no sub-questions were given. Set \
        \"stop\" to true only if \"unanswered\" is empty."
    )
}

#[derive(serde::Deserialize)]
struct StopReply {
    #[serde(default)]
    unanswered: Vec<String>,
    #[serde(default)]
    stop: bool,
}

pub fn parse_stop_decision(reply: &str) -> bool {
    let cleaned = reply.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```");
    if let Ok(parsed) = serde_json::from_str::<StopReply>(cleaned.trim()) {
        return parsed.stop && parsed.unanswered.is_empty();
    }
    reply.trim().to_uppercase().starts_with("YES")
}

pub fn build_final_report_prompt(topic: &str, report: &str, category: Option<&str>) -> String {
    let mut prompt = format!(
        "Write a **long, detailed, comprehensive** research report answering this question:\n\n\
        **Question:** {topic}\n\n**All collected evidence and analysis:**\n{report}\n\n\
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
        - Write in an engaging, informative style — not dry or robotic"
    );
    if let Some(extra) = category.and_then(category_format_override) {
        prompt.push_str("\n\n");
        prompt.push_str(extra);
    }
    prompt
}

pub const EXPANSION_REQUEST: &str = "This report is too brief. Please expand it significantly:\n\
    - Add detailed paragraphs for each section (not just bullet points)\n\
    - Include specific data, numbers, and comparisons from the evidence\n\
    - Explain context and significance — don't just list facts\n\
    - Use ## headings and ### subheadings\n\
    - Target at least 1000 words\n\
    Write the full expanded report now.";

/// Below this word count, Odysseus asks the model to expand the final report once.
pub const MIN_FINAL_REPORT_WORDS: usize = 400;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn low_quality_catches_markers_and_empty() {
        assert!(is_low_quality(""));
        assert!(is_low_quality("This page contains a cookie consent banner only."));
        assert!(!is_low_quality("The product costs $50 and ships in 3 days."));
    }

    #[test]
    fn parse_search_results_pairs_title_and_url() {
        let output = "Search results for: rust\n\n[1] Rust Book\n    URL: https://a.example\n    snippet\n\n[2] Crates\n    URL: https://b.example\n";
        let results = parse_search_results(output);
        assert_eq!(results, vec![
            ("Rust Book".to_string(), "https://a.example".to_string()),
            ("Crates".to_string(), "https://b.example".to_string()),
        ]);
    }

    #[test]
    fn parse_category_accepts_word_and_sentence() {
        assert_eq!(parse_category("product"), Some("product".to_string()));
        assert_eq!(parse_category("I'd say this is a comparison."), Some("comparison".to_string()));
        assert_eq!(parse_category("unrelated text"), None);
    }

    #[test]
    fn parse_plan_falls_back_to_raw_on_non_json() {
        let fallback = parse_plan("not json");
        assert_eq!(fallback.summary, "not json");
        assert!(fallback.sub_questions.is_empty());

        let json = r#"{"sub_questions": ["a?"], "key_topics": ["x"], "success_criteria": "done"}"#;
        let plan = parse_plan(json);
        assert_eq!(plan.summary, "Sub-questions: a?\nKey topics: x\nSuccess: done");
        assert_eq!(plan.sub_questions, vec!["a?".to_string()]);
    }

    #[test]
    fn parse_stop_decision_requires_empty_unanswered() {
        assert!(parse_stop_decision(r#"{"unanswered": [], "stop": true}"#));
        assert!(!parse_stop_decision(r#"{"unanswered": ["gap"], "stop": true}"#));
        assert!(!parse_stop_decision(r#"{"unanswered": ["gap"], "stop": false}"#));
        assert!(parse_stop_decision("YES — looks complete."));
        assert!(!parse_stop_decision("NO — missing pricing info."));
    }
}
