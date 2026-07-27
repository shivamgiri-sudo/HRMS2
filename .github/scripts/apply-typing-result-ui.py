from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label} mismatch: {count}")
    return text.replace(old, new, 1)


page = Path("backend/src/modules/ats-assessment/assessment.page.ts")
text = page.read_text()
text = replace_once(
    text,
    'Number(attempt.accuracy||0).toFixed(1)+"% accuracy · "+Number(attempt.score||0).toFixed(1)+"% score',
    'Number(attempt.accuracy||0).toFixed(1)+"% accuracy · "+Number(attempt.completionPercentage||0).toFixed(1)+"% completion · "+Number(attempt.score||0).toFixed(1)+"% score',
    "candidate submitted attempt completion",
)
text = replace_once(
    text,
    '''$("typingAccuracy").textContent=attempted.accuracy.toFixed(1)+"%";$("typingCharacters").textContent=Array.from(text).length;const remaining''',
    '''$("typingAccuracy").textContent=attempted.accuracy.toFixed(1)+"%";$("typingCharacters").textContent=Array.from(text).length;const referenceCharacters=Array.from(typingState.passage).length;const completion=referenceCharacters?Math.min(100,attempted.prefixLength/referenceCharacters*100):0;if($("typingCompletion"))$("typingCompletion").textContent=completion.toFixed(1)+"%";const remaining''',
    "candidate live completion calculation",
)
text = replace_once(
    text,
    '''<div class="metric"><b id="typingCharacters">0</b><span>Characters</span></div></div><div class="notice warning">''',
    '''<div class="metric"><b id="typingCharacters">0</b><span>Characters</span></div><div class="metric"><b id="typingCompletion">0%</b><span>Completion</span></div></div><div class="notice warning">''',
    "candidate live completion metric",
)
text = replace_once(
    text,
    '''<div class="metrics"><div class="metric"><b>'+Number(result.netWpm||0).toFixed(1)+'</b><span>Net WPM</span></div><div class="metric"><b>'+Number(result.accuracy||0).toFixed(1)+'%</b><span>Accuracy</span></div><div class="metric"><b>'+esc(result.correctWords||0)+'</b><span>Correct Words</span></div><div class="metric"><b>'+esc(result.incorrectWords||0)+'</b><span>Word Errors</span></div></div>''',
    '''<div class="metrics"><div class="metric"><b>'+Number(result.grossWpm||0).toFixed(1)+'</b><span>Gross WPM</span></div><div class="metric"><b>'+Number(result.netWpm||0).toFixed(1)+'</b><span>Net WPM</span></div><div class="metric"><b>'+Number(result.accuracy||0).toFixed(1)+'%</b><span>Accuracy</span></div><div class="metric"><b>'+Number(result.completionPercentage||0).toFixed(1)+'%</b><span>Completion</span></div></div>''',
    "candidate final typing metrics",
)
page.write_text(text)


admin = Path("backend/src/modules/ats-assessment/assessment.admin.page.ts")
text = admin.read_text()
text = replace_once(
    text,
    '''Number(row.best_net_wpm).toFixed(1)+" WPM · "+Number(row.best_accuracy||0).toFixed(1)+"%"''',
    '''Number(row.best_net_wpm).toFixed(1)+" WPM · "+Number(row.best_accuracy||0).toFixed(1)+"% accuracy · "+Number(row.best_completion_percentage||0).toFixed(1)+"% complete"''',
    "admin list coherent typing metrics",
)
text = replace_once(
    text,
    '''esc(t.netWpm??0)+" WPM · "+esc(t.accuracy??0)+"% accuracy · "+badge(t.passedBenchmark?"Passed benchmark":"Benchmark not met")''',
    '''esc(t.netWpm??0)+" WPM · "+esc(t.accuracy??0)+"% accuracy · "+Number(t.completionPercentage||0).toFixed(1)+"% completion · "+badge(t.passedBenchmark?"Passed benchmark":"Benchmark not met")''',
    "admin detail completion",
)
text = replace_once(
    text,
    '''Optional: <b>recommendedDurationSeconds, minWpmBenchmark, minAccuracyBenchmark</b>.''',
    '''Optional: <b>recommendedDurationSeconds, minWpmBenchmark, minAccuracyBenchmark</b>. Passages require at least 30 words / 150 characters, cannot exceed 2500 characters, and cannot lower the assigned role benchmark.''',
    "admin passage import guidance",
)
admin.write_text(text)
