import { ComprehensiveTeacherData } from "@/hooks/useComprehensiveTeacherAnalytics";
import { getDisplaySection } from "@/lib/sectionDisplay";

interface TeacherReportPrintableProps {
  data: ComprehensiveTeacherData;
  selectedClassName?: string;
}

export function TeacherReportPrintable({ data, selectedClassName }: TeacherReportPrintableProps) {
  const { profile, overallMetrics, classes, studentPerformance, topicGaps, recommendations, sectionDivisions } = data;
  const now = new Date();

  return (
    <div style={{ fontFamily: "'Segoe UI', Arial, sans-serif", color: "#1a1a1a", background: "#fff", padding: "32px 28px", maxWidth: "794px", lineHeight: 1.5 }}>
      {/* Header */}
      <div style={{ borderBottom: "3px solid #2563eb", paddingBottom: "16px", marginBottom: "24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, margin: 0, color: "#1e3a5f" }}>
          Teaching Performance Report
        </h1>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px", fontSize: "13px", color: "#555" }}>
          <div>
            <strong>{profile.name}</strong> &bull; {profile.subjects.join(", ") || "N/A"} &bull; {profile.classCount} Class(es)
          </div>
          <div>
            Generated: {now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
            {selectedClassName && <span> &bull; Filter: {selectedClassName}</span>}
          </div>
        </div>
      </div>

      {/* Summary Metrics */}
      <SectionTitle>Summary Metrics</SectionTitle>
      <table style={tableStyle}>
        <thead>
          <tr>
            <Th>Metric</Th>
            <Th>Value</Th>
          </tr>
        </thead>
        <tbody>
          <MetricRow label="Class Average Accuracy" value={`${overallMetrics.overallAccuracy.toFixed(1)}%`} />
          <MetricRow label="Top Performer Score" value={`${overallMetrics.topperAccuracy.toFixed(1)}%`} />
          <MetricRow label="Avg Time / Question" value={`${overallMetrics.avgTimePerQuestion.toFixed(1)}s`} />
          <MetricRow label="Class Efficiency" value={overallMetrics.efficiency.toFixed(2)} />
          <MetricRow label="Total Students" value={overallMetrics.totalStudents} />
          <MetricRow label="Needs Attention (<50%)" value={overallMetrics.needsAttentionCount} highlight="red" />
          <MetricRow label="Developing (50-65%)" value={overallMetrics.developingCount} highlight="orange" />
          <MetricRow label="Stable (>65%)" value={overallMetrics.stableCount} highlight="green" />
        </tbody>
      </table>

      {/* Class-wise Performance */}
      {classes.length > 1 && (
        <>
          <SectionTitle>Class-wise Performance</SectionTitle>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>Class</Th>
                <Th>Section</Th>
                <Th>Students</Th>
                <Th>Avg Accuracy</Th>
                <Th>Pass Rate</Th>
                <Th>Needs Attention</Th>
              </tr>
            </thead>
            <tbody>
              {classes.map((c, i) => (
                <tr key={i} style={i % 2 === 0 ? evenRow : {}}>
                  <Td>{c.className}</Td>
                  <Td align="center">{getDisplaySection(c.className, c.section) ?? c.section}</Td>
                  <Td align="center">{c.studentCount}</Td>
                  <Td align="center">{c.avgAccuracy.toFixed(1)}%</Td>
                  <Td align="center">{c.passRate.toFixed(0)}%</Td>
                  <Td align="center" style={{ color: c.needsAttention > 0 ? "#dc2626" : "#16a34a" }}>{c.needsAttention}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Student Performance */}
      <SectionTitle>Student Performance</SectionTitle>
      <table style={tableStyle}>
        <thead>
          <tr>
            <Th>#</Th>
            <Th>Student Name</Th>
            <Th>Class</Th>
            <Th>Accuracy</Th>
            <Th>Avg Time</Th>
            <Th>Efficiency</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {studentPerformance.map((s, i) => (
            <tr key={i} style={i % 2 === 0 ? evenRow : {}}>
              <Td align="center">{i + 1}</Td>
              <Td>{s.studentName}</Td>
              <Td>{s.className}</Td>
              <Td align="center" style={{ fontWeight: 600, color: s.overallPercent < 50 ? "#dc2626" : s.overallPercent < 65 ? "#d97706" : "#16a34a" }}>
                {s.overallPercent.toFixed(1)}%
              </Td>
              <Td align="center">{s.avgTime.toFixed(1)}s</Td>
              <Td align="center">{s.efficiency.toFixed(2)}</Td>
              <Td align="center">
                <span style={{
                  padding: "2px 8px",
                  borderRadius: "4px",
                  fontSize: "11px",
                  fontWeight: 600,
                  background: s.status === "Needs Attention" ? "#fef2f2" : s.status === "Developing" ? "#fffbeb" : "#f0fdf4",
                  color: s.status === "Needs Attention" ? "#dc2626" : s.status === "Developing" ? "#d97706" : "#16a34a",
                }}>
                  {s.status}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Topic Gaps */}
      {topicGaps.length > 0 && (
        <>
          <SectionTitle>Chapter Gaps</SectionTitle>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>Chapter</Th>
                <Th>Class Average</Th>
                <Th>Severity</Th>
                <Th>Students Affected</Th>
              </tr>
            </thead>
            <tbody>
              {topicGaps.map((g, i) => (
                <tr key={i} style={i % 2 === 0 ? evenRow : {}}>
                  <Td>{g.topic}</Td>
                  <Td align="center" style={{ color: g.severity === "Critical" ? "#dc2626" : "#d97706" }}>{g.classAvg.toFixed(1)}%</Td>
                  <Td align="center">
                    <span style={{
                      padding: "2px 8px",
                      borderRadius: "4px",
                      fontSize: "11px",
                      fontWeight: 600,
                      background: g.severity === "Critical" ? "#fef2f2" : "#fffbeb",
                      color: g.severity === "Critical" ? "#dc2626" : "#d97706",
                    }}>
                      {g.severity}
                    </span>
                  </Td>
                  <Td align="center">{g.studentsAffected}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <>
          <SectionTitle>Recommendations</SectionTitle>
          {recommendations.map((rec, i) => (
            <div key={i} style={{ marginBottom: "14px", padding: "12px 16px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", pageBreakInside: "avoid" }}>
              <div style={{ fontWeight: 700, fontSize: "13px", marginBottom: "4px" }}>
                {rec.icon} {rec.title}
              </div>
              <p style={{ fontSize: "12px", margin: "0 0 8px 0", color: "#555" }}>{rec.message}</p>
              {rec.references.length > 0 && (
                <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                  {rec.references.map((r, j) => (
                    <span key={j} style={{ fontSize: "11px", color: "#666" }}>
                      <strong>{r.metric}:</strong> {r.value}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {/* Section Division */}
      {sectionDivisions.some(s => s.count > 0) && (
        <>
          <SectionTitle>Remedial Grouping</SectionTitle>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>Group</Th>
                <Th>Criteria</Th>
                <Th>Count</Th>
                <Th>Students</Th>
              </tr>
            </thead>
            <tbody>
              {sectionDivisions.map((sec, i) => (
                <tr key={i} style={i % 2 === 0 ? evenRow : {}}>
                  <Td style={{ fontWeight: 600, color: sec.color }}>{sec.sectionName}</Td>
                  <Td>{sec.criteria}</Td>
                  <Td align="center">{sec.count}</Td>
                  <Td style={{ fontSize: "11px" }}>
                    {sec.students.slice(0, 8).map(s => `${s.name} (${s.accuracy.toFixed(0)}%)`).join(", ")}
                    {sec.students.length > 8 && ` +${sec.students.length - 8} more`}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Footer */}
      <div style={{ marginTop: "32px", paddingTop: "12px", borderTop: "1px solid #e5e7eb", fontSize: "10px", color: "#999", textAlign: "center" }}>
        Report generated by SALCI &bull; {now.toLocaleDateString("en-IN")} {now.toLocaleTimeString("en-IN")} &bull; Confidential
      </div>
    </div>
  );
}

// ---------- Styled primitives (inline for PDF) ----------

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "12px",
  marginBottom: "20px",
};

const evenRow: React.CSSProperties = { background: "#f9fafb" };

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: "15px", fontWeight: 700, color: "#1e3a5f", margin: "24px 0 10px 0", borderBottom: "1px solid #cbd5e1", paddingBottom: "4px", pageBreakAfter: "avoid" }}>
      {children}
    </h2>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: string }) {
  return (
    <th style={{ textAlign: (align || "left") as any, padding: "8px 10px", borderBottom: "2px solid #cbd5e1", fontSize: "11px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>
      {children}
    </th>
  );
}

function Td({ children, align, style }: { children: React.ReactNode; align?: string; style?: React.CSSProperties }) {
  return (
    <td style={{ textAlign: (align || "left") as any, padding: "6px 10px", borderBottom: "1px solid #e5e7eb", ...style }}>
      {children}
    </td>
  );
}

function MetricRow({ label, value, highlight }: { label: string; value: string | number; highlight?: "red" | "orange" | "green" }) {
  const colorMap = { red: "#dc2626", orange: "#d97706", green: "#16a34a" };
  return (
    <tr>
      <Td style={{ fontWeight: 500 }}>{label}</Td>
      <Td align="center" style={{ fontWeight: 700, color: highlight ? colorMap[highlight] : undefined }}>{value}</Td>
    </tr>
  );
}
