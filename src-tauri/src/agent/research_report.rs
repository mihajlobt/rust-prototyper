//! Structured final-output assembly — mirrors Odysseus's
//! `services/research/research_handler.py::_format_research_report`.

use std::collections::HashSet;

/// One quality-passed, extracted finding (a single URL's relevant notes).
pub struct Finding {
    pub url: String,
    pub title: String,
    pub notes: String,
}

/// Run-level counters surfaced in the "## Research Summary" stat line.
pub struct ResearchStats {
    pub elapsed_secs: f64,
    pub rounds: u8,
    pub queries: u32,
    pub urls_analyzed: usize,
}

/// Wraps the LLM's final report prose with a stats summary, a curated Sources
/// list (quality-filtered, deduped), an unfiltered Analyzed URLs audit list,
/// and a collapsible raw-findings section — same four sections Odysseus appends.
pub fn format_research_report(
    topic: &str,
    final_report: &str,
    stats: &ResearchStats,
    findings: &[Finding],
    analyzed_urls: &[(String, String)],
) -> String {
    let summary = format!(
        "**Duration:** {:.1}s | **Rounds:** {} | **Queries:** {} | **URLs Analyzed:** {}",
        stats.elapsed_secs, stats.rounds, stats.queries, stats.urls_analyzed
    );

    let mut seen_sources = HashSet::new();
    let source_lines: Vec<String> = findings.iter()
        .filter(|f| seen_sources.insert(f.url.clone()))
        .map(|f| format!("- [{}]({})", f.title, f.url))
        .collect();
    let sources_section = if source_lines.is_empty() {
        String::new()
    } else {
        format!("\n### Sources\n\n{}\n", source_lines.join("\n"))
    };

    let mut seen_analyzed = HashSet::new();
    let mut analyzed_lines = Vec::new();
    for (url, title) in analyzed_urls {
        if seen_analyzed.insert(url.clone()) {
            analyzed_lines.push(format!("{}. [{}]({})", analyzed_lines.len() + 1, title, url));
        }
    }
    let analyzed_section = if analyzed_lines.is_empty() {
        String::new()
    } else {
        format!("\n### Analyzed URLs\n\n{}\n", analyzed_lines.join("\n"))
    };

    let raw_section = if findings.is_empty() {
        String::new()
    } else {
        let parts: Vec<String> = findings.iter().enumerate()
            .map(|(i, f)| format!("**{}. [{}]({})**\n\n{}", i + 1, f.title, f.url, f.notes))
            .collect();
        format!(
            "\n<details>\n<summary><strong>Raw collected findings ({} sources)</strong></summary>\n\n{}\n\n</details>\n",
            findings.len(), parts.join("\n\n"),
        )
    };

    format!(
        "---\n\n## Research Summary\n\n{summary}\n\n---\n\n{final_report}\n\n{sources_section}\n\
        {analyzed_section}\n{raw_section}\n---\n\n\
        **The AI has analyzed all research findings above. Ask me anything about: \"{topic}\"**\n"
    )
}
