# SALCI Dashboard Metrics Audit Report
**Version:** 1.0  
**Date:** January 27, 2026  
**Status:** Comprehensive Audit Complete

---

## Executive Summary

This document provides a **complete audit** of all metrics, calculations, and data flows across SALCI's dashboard ecosystem. The audit covers data accuracy, calculation logic, cross-dashboard consistency, and edge case handling.

### Key Findings

| Area | Status | Notes |
|------|--------|-------|
| Core Metrics (Accuracy, Efficiency) | ✅ Consistent | Same formulas across all dashboards |
| Data Sources | ✅ Unified | Single source of truth via snapshot tables |
| Edge Case Handling | ⚠️ Partial | Some metrics show 0 vs N/A inconsistently |
| Cross-Dashboard Consistency | ⚠️ Minor Issues | Same metric, different threshold labels |
| Real-time vs Cached | ✅ Clear | Aggregates are computed via edge function |
| NEP/Competency Alignment | ✅ Strong | Focus on learning gaps, not just scores |

---

## 1. Metrics Dictionary

### 1.1 Core Performance Metrics

| Metric | Definition | Formula | Source Table | Unit |
|--------|------------|---------|--------------|------|
| **Accuracy %** | Percentage of correct answers out of attempted | `(questions_correct / questions_attempted) * 100` | `student_performance_snapshots.accuracy_percent` | % |
| **Avg Time/Question** | Average seconds spent per question | `total_time_seconds / total_questions` | `student_performance_snapshots.avg_time_per_question_seconds` | seconds |
| **Efficiency Score** | Proprietary metric balancing speed and accuracy | `accuracy_percent / avg_time_per_question_seconds` | `student_performance_snapshots.efficiency_score` | ratio |
| **Pass Rate** | Percentage of students who passed (≥50%) | `(count(accuracy >= 50) / total_students) * 100` | Computed from snapshots | % |
| **Consistency Score** | Stability of performance across exams | `100 - standard_deviation(percentages)` | Computed client-side | 0-100 |
| **Percentile Rank** | Student's position relative to class | `(students_below / total_students) * 100` | Computed client-side | % |

### 1.2 Aggregation Metrics

| Metric | Definition | Formula | Source |
|--------|------------|---------|--------|
| **School Average** | Mean accuracy across all student snapshots | `sum(accuracy) / count(snapshots)` | `class_aggregates` → computed |
| **Class Average** | Mean accuracy within a class | `sum(class_accuracy) / class_student_count` | `class_aggregates.avg_accuracy_percent` |
| **Topper Accuracy** | Highest accuracy in class/exam | `max(accuracy_percent)` | `class_aggregates.topper_accuracy_percent` |
| **Performance Rating** | School rating out of 5 | `min(5, schoolAverage / 20)` | Computed |

### 1.3 Status Classifications

| Status | Threshold | Used In |
|--------|-----------|---------|
| **Needs Attention** | Accuracy < 50% | Student, Teacher, Principal dashboards |
| **Developing** | 50% ≤ Accuracy < 65% | Student, Teacher, Principal dashboards |
| **Stable** | Accuracy ≥ 65% | Student, Teacher, Principal dashboards |
| **Excellent** | Accuracy ≥ 85% | Performance status labels |
| **Very Good** | 75% ≤ Accuracy < 85% | Performance status labels |
| **Good** | 65% ≤ Accuracy < 75% | Performance status labels |
| **At Risk (Class)** | Class Average < 50% | Principal dashboard |

### 1.4 Trend Analysis

| Metric | Logic | Threshold |
|--------|-------|-----------|
| **Improving** | Second-half average > first-half average by 5%+ | `secondAvg > firstAvg + 5` |
| **Declining** | Second-half average < first-half average by 5%+ | `secondAvg < firstAvg - 5` |
| **Stable** | Difference within ±5% | Default |

---

## 2. Dashboard-Wise Metrics Mapping

### 2.1 Student Dashboard (`ComprehensiveStudentDashboard`)

**Hook:** `useComprehensiveStudentAnalytics`

| UI Element | Metric | Source | Calculation |
|------------|--------|--------|-------------|
| Overall Accuracy | `overallPercentage` | `student_performance_snapshots` | Average of all `accuracy_percent` |
| Avg Time/Question | `avgTimePerQuestion` | `student_performance_snapshots` | Average of `avg_time_per_question_seconds` |
| Efficiency Score | `efficiencyScore` | `student_performance_snapshots` | Average of `efficiency_score` |
| Exams Taken | `totalExams` | `student_performance_snapshots` | Count of snapshots |
| Pass Rate | `passRate` | `final_results` | `(passed_count / total) * 100` |
| Performance Status | `performanceStatus` | Computed | Based on `overallPercentage` thresholds |
| Strongest Subject | `strongestSubject` | `student_topic_performance` | Highest average accuracy |
| Weakest Subject | `weakestSubject` | `student_topic_performance` | Lowest average accuracy |
| Percentile Rank | `percentileRank` | Computed | Position vs classmates |
| Consistency Score | `consistencyScore` | Computed | `100 - stdev(percentages)` |
| Trend | `trend` | Computed | Comparing recent exam halves |

**Class Comparison Table:**
- Your Score vs Class Average vs Topper
- Sources: `student_performance_snapshots`, `class_aggregates`

### 2.2 Teacher Dashboard (`ComprehensiveTeacherDashboard`)

**Hook:** `useComprehensiveTeacherAnalytics`

| UI Element | Metric | Source | Calculation |
|------------|--------|--------|-------------|
| Total Students | `totalStudents` | `student_performance_snapshots` | Count for assigned classes |
| Overall Accuracy | `overallAccuracy` | Snapshots | Average across students |
| Avg Time/Question | `avgTimePerQuestion` | Snapshots | Average across students |
| Efficiency | `efficiency` | Snapshots | Average efficiency score |
| Topper Accuracy | `topperAccuracy` | Snapshots | `max(accuracy_percent)` |
| Needs Attention Count | `needsAttentionCount` | Computed | Count where accuracy < 50% |
| Developing Count | `developingCount` | Computed | Count where 50% ≤ accuracy < 65% |
| Stable Count | `stableCount` | Computed | Count where accuracy ≥ 65% |
| Topic Gaps | `topicGaps` | `student_topic_performance` | Topics with avg < 60% |
| Section Divisions | `sectionDivisions` | Computed | Grouped by accuracy ranges |

**Score Distribution Ranges:**
- 0-30%: Critical (Red)
- 31-50%: Warning (Orange)
- 51-70%: Average (Yellow)
- 71-85%: Good (Light Green)
- 86-100%: Excellent (Green)

**Topic Gap Severity:**
- Critical: < 40%
- Moderate: 40-60%
- Low: 60%+ (not shown as gap)

### 2.3 Principal Dashboard (`ComprehensivePrincipalDashboard`)

**Hook:** `useComprehensivePrincipalAnalytics`

| UI Element | Metric | Source | Calculation |
|------------|--------|--------|-------------|
| Total Students | `totalStudents` | Snapshots | Count of unique students |
| Total Classes | `totalClasses` | `classes` | Count for institution |
| Total Teachers | `totalTeachers` | `user_roles` | Count where role=teacher |
| School Average | `schoolAverage` | Computed | Average of all accuracies |
| Attendance Rate | `attendanceRate` | **HARDCODED** | Currently returns `92` |
| Performance Rating | `performanceRating` | Computed | `min(5, schoolAverage / 20)` |
| Pass Rate | `passRate` | Computed | `(passed / total) * 100` |
| Class Performance | Array | Aggregates + Snapshots | Per-class breakdown |
| Student Positioning | Matrix | Computed | NA/Developing/Stable counts |
| Subject Risks | Array | Teacher assignments + Snapshots | Risk by subject |
| Teacher Actions | Array | Computed | Suggested interventions |

**Class Status Labels:**
- Excellent: Average ≥ 80%
- Good: 65% ≤ Average < 80%
- Average: 50% ≤ Average < 65%
- At Risk: Average < 50%

**Subject Risk Levels:**
- High: Average < 60%
- Moderate: 60% ≤ Average < 75%
- Stable: Average ≥ 75%

### 2.4 Super Admin Dashboard

**Hook:** `useSuperAdminStats`, `useDashboardData`

| UI Element | Metric | Source | Calculation |
|------------|--------|--------|-------------|
| Total Institutions | Count | `institutions` | `count(*)` |
| Active Institutions | Count | `institutions` | `count(is_active = true)` |
| Total Users | Count | `profiles` | `count(*)` |
| Total Exams | Count | `exams` | `count(*)` |
| Total Classes | Count | `classes` | `count(*)` |
| Exams by Status | Breakdown | `exams` | Grouped by status |

### 2.5 Reports Page (`StudentReportsPage`)

**Hook:** `useEnhancedStudentAnalytics`

Same metrics as Student Dashboard, but with:
- PDF export capability
- Subject/time range filters
- Visual trend charts

### 2.6 Exam Reports

**Hook:** `useReportAnalytics`

| UI Element | Metric | Source | Calculation |
|------------|--------|--------|-------------|
| Score Distribution | Histogram | `final_results` | Grouped in 10% buckets |
| Grade Distribution | Pie chart | `final_results` | A/B/C/D/F from percentage |
| Class Comparison | Bar chart | `final_results` + `classes` | Per-class averages |
| Question Analytics | Table | `student_answers` + `teacher_overrides` | Per-question stats |
| Difficulty Index | Per question | Computed | `1 - (avgPercentage / 100)` |
| Skip Rate | Per question | `attempt_question_telemetry` | `(skipped / attempted) * 100` |

**Grade Thresholds:**
- A: ≥ 90%
- B: 80-89%
- C: 70-79%
- D: 60-69%
- F: < 60%

### 2.7 Payments Dashboard

**Hook:** `usePayments`, `useRevenueAnalytics`

| UI Element | Metric | Source | Calculation |
|------------|--------|--------|-------------|
| Total Revenue | Sum | `payment_records` | Sum where status='completed' |
| MRR | Sum | `institution_subscriptions` | Sum of active monthly_amount |
| Active Subscriptions | Count | `institution_subscriptions` | Count where status='active' |
| Avg Revenue/School | Ratio | Computed | `MRR / activeSubscriptions` |

### 2.8 AI Quota Dashboard

**Hook:** `useAIQuotaDashboard`

| UI Element | Metric | Source | Calculation |
|------------|--------|--------|-------------|
| Questions Used Today | Count | `user_question_limits` | Sum for today |
| Total Daily Limit | Sum | `user_question_limits` | Sum of daily_limit |
| Users with Limits | Count | `user_question_limits` | Count of records |
| Institution Quota | Config | `ai_usage_quotas` | Direct read |

---

## 3. Data Flow Architecture

```
┌─────────────────┐    ┌──────────────────────┐    ┌─────────────────────┐
│ Student Answers │───▶│ teacher_overrides    │───▶│ final_results       │
│ (Raw responses) │    │ (Evaluated marks)    │    │ (Published scores)  │
└─────────────────┘    └──────────────────────┘    └─────────────────────┘
                                                              │
                                                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    compute_student_performance_snapshot()                │
│   Triggered on: attempt.is_finalized = true                             │
│   Creates: student_performance_snapshots record                          │
└─────────────────────────────────────────────────────────────────────────┘
                                                              │
                                                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       compute-aggregates Edge Function                    │
│   Triggered: Manual or on exam completion                                │
│   Creates: class_aggregates, school_aggregates                           │
└─────────────────────────────────────────────────────────────────────────┘
                                                              │
                                                              ▼
                       ┌──────────────────────────┐
                       │   Dashboard Queries       │
                       │   (Real-time reads)       │
                       └──────────────────────────┘
```

---

## 4. Source of Truth Mapping

| Data Type | Source Table | Real-time? | Caching |
|-----------|--------------|------------|---------|
| Raw student responses | `student_answers` | Yes | None |
| Evaluated marks | `teacher_overrides` | Yes | None |
| Final scores | `final_results` | Yes | None |
| Student snapshots | `student_performance_snapshots` | Yes | Computed on finalize |
| Class averages | `class_aggregates` | No | Computed via edge function |
| Topic mastery | `student_topic_performance` | Yes | None |
| Question telemetry | `attempt_question_telemetry` | Yes | None |

---

## 5. Cross-Dashboard Consistency Analysis

### ✅ Consistent Metrics

| Metric | Dashboards | Verdict |
|--------|------------|---------|
| Accuracy % | All | Same formula: `(correct/attempted)*100` |
| Efficiency Score | Student, Teacher | Same: `accuracy/time` |
| Pass Rate | All | Same: `count(>=50%) / total` |
| Needs Attention threshold | All | Same: `< 50%` |

### ⚠️ Inconsistencies Found

| Issue | Dashboards Affected | Recommendation |
|-------|---------------------|----------------|
| "Stable" vs "Developing" boundary | Teacher (65%) vs Student reports (no label) | Standardize thresholds |
| Attendance Rate | Principal | **HARDCODED at 92%** - needs real data |
| Performance Rating | Principal | `schoolAvg/20` caps at 5, but unclear scale |
| Class vs Topper comparison | Student | Topper for "time" is simulated (`avgTime * 0.8`) |
| Class efficiency avg | Student | Simulated (`efficiencyScore * 0.9`) |

### ⚠️ Simulated/Placeholder Values

Located in `useStudentDashboard.ts` and `useComprehensiveStudentAnalytics.ts`:

```typescript
// Line 207-208: Simulated class averages
const classAvg = overallAccuracy * 0.95; // Simulated
const topperPercent = accuracy * 1.1 > 100 ? 100 : accuracy * 1.1; // Simulated

// Line 258-259: Simulated comparison
topper: avgTimePerQuestion * 0.8, // Simulated
topper: efficiencyScore * 1.2, // Simulated
```

**Impact:** Class comparison table shows estimated values, not real class data.

**Fix:** Pull actual class averages from `class_aggregates` for each subject.

---

## 6. Edge Cases & Failure Scenarios

### 6.1 No Exams Exist

| Dashboard | Behavior | Verdict |
|-----------|----------|---------|
| Student | Shows "Complete some exams to see your analytics!" | ✅ Good |
| Teacher | Returns empty arrays, metrics = 0 | ✅ Acceptable |
| Principal | School average = 0, empty class lists | ⚠️ Could show "No data" |

### 6.2 Partial Exam Attempt

| Scenario | Handling | Verdict |
|----------|----------|---------|
| Student starts but doesn't submit | Not counted in analytics | ✅ Correct |
| Student submits incomplete | Counted with actual responses | ✅ Correct |
| Skipped questions | Tracked in telemetry, not penalized | ✅ Good |

### 6.3 Exam Deleted/Modified

| Scenario | Handling | Verdict |
|----------|----------|---------|
| Exam deleted | Snapshots remain (historical data preserved) | ✅ Good |
| Questions edited after submission | Original answers preserved | ✅ Good |
| Exam unpublished | Results still visible if previously published | ⚠️ Consider hiding |

### 6.4 Student Retakes

| Scenario | Current Behavior | Verdict |
|----------|------------------|---------|
| Same exam multiple attempts | Only one attempt allowed (enforced) | ✅ By design |
| Different exam same class | Each creates separate snapshot | ✅ Correct |

### 6.5 Missing Teacher Overrides

| Scenario | Handling | Verdict |
|----------|----------|---------|
| AI evaluated but not reviewed | `requires_teacher_review = true` | ✅ Tracked |
| Finalization without full review | Trigger validation blocks | ✅ Enforced |
| Question with no evaluation | Uses AI suggestion or 0 | ⚠️ Could mislead |

### 6.6 Data Delays

| Scenario | Handling | Verdict |
|----------|----------|---------|
| Aggregates not computed | Uses real-time calculations | ✅ Fallback works |
| Stale class_aggregates | Manual "Recompute Analytics" button | ✅ Available |

---

## 7. NEP/Competency Alignment Assessment

### ✅ Aligned Features

| Feature | NEP Alignment | Notes |
|---------|---------------|-------|
| Concept Mastery Tracking | ✅ | Focus on topic-level understanding |
| Topic Gap Identification | ✅ | Highlights weak areas for intervention |
| Learning Actions | ✅ | Personalized recommendations |
| Efficiency Score | ✅ | Balances speed and understanding |
| Trend Analysis | ✅ | Growth mindset, not single-point |

### ⚠️ Areas for Improvement

| Metric | Current | Recommendation |
|--------|---------|----------------|
| Pass Rate emphasis | Prominent on all dashboards | De-emphasize; focus on growth |
| Grade labels (A/B/C/D/F) | Western grading system | Consider competency levels |
| Percentile Rank | Competitive comparison | Balance with self-improvement |
| "Needs Attention" label | Deficit-focused | Consider "Emerging" or "Growing" |

### 🔴 Metrics to Reconsider

| Metric | Issue | Action |
|--------|-------|--------|
| `attendanceRate: 92` | Hardcoded, misleading | Remove or implement real tracking |
| Simulated class averages | Not real data | Pull from `class_aggregates` |
| Performance Rating (out of 5) | Unclear scale meaning | Document or redesign |

---

## 8. Actionable Recommendations

### 8.1 Critical Fixes

1. **Remove hardcoded attendance rate** (`useComprehensivePrincipalAnalytics.ts:171`)
   - Either implement real attendance tracking or remove metric

2. **Fix simulated class comparisons** (`useStudentDashboard.ts:207-208`)
   - Pull actual subject-specific averages from `class_aggregates`

3. **Standardize status thresholds** across all dashboards
   - Document in a single config file

### 8.2 Improvements

1. **Add "No Data" states** instead of showing 0 for metrics
2. **Implement subject-level class aggregates** for accurate comparison
3. **Add data freshness indicator** showing when aggregates were last computed
4. **Create metrics config file** centralizing all thresholds

### 8.3 Documentation

1. **Add tooltips** explaining each metric on dashboards
2. **Create public metrics glossary** for parents/students
3. **Document all thresholds** in a single source

---

## 9. Appendix: File References

| File | Purpose |
|------|---------|
| `src/hooks/useComprehensiveStudentAnalytics.ts` | Student dashboard metrics |
| `src/hooks/useComprehensiveTeacherAnalytics.ts` | Teacher dashboard metrics |
| `src/hooks/useComprehensivePrincipalAnalytics.ts` | Principal dashboard metrics |
| `src/hooks/useStudentDashboard.ts` | Enhanced student analytics |
| `src/hooks/usePrincipalDashboard.ts` | Principal overview & heatmap |
| `src/hooks/useTeacherDashboard.ts` | Teacher class overview |
| `src/hooks/useReportAnalytics.ts` | Exam report analytics |
| `src/hooks/useDashboardData.ts` | Role-specific dashboard stats |
| `src/hooks/usePayments.ts` | Revenue & billing metrics |
| `src/hooks/useAIQuotaDashboard.ts` | AI usage tracking |
| `supabase/functions/compute-aggregates/index.ts` | Aggregation edge function |

---

## 10. Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-27 | SALCI Audit | Initial comprehensive audit |

---

*This document should be reviewed quarterly and updated when new metrics are added or calculation logic changes.*
