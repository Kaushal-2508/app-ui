// Reusable shared components for dashboards and reports

export { MetricCard } from "./MetricCard";
export { StatusBadge, getStatusFromPercentage, getStatusFromTrend } from "./StatusBadge";
export type { StatusType } from "./StatusBadge";
export { TrendIndicator, TrendBadge, determineTrend } from "./TrendIndicator";
export type { TrendDirection } from "./TrendIndicator";
export { FilterBar, ActiveFilterTags } from "./FilterBar";
export type { FilterConfig, FilterOption } from "./FilterBar";
export { DataTable } from "./DataTable";
export type { ColumnDef, DataTableProps } from "./DataTable";
export { MobileDataCard, MobileDataList } from "./MobileDataCard";
export type { MobileDataCardField } from "./MobileDataCard";
export { ReportDownloadButton, PrintableReport } from "./ReportDownloadButton";
export {
  PerformanceBarChart,
  PerformanceLineChart,
  PerformancePieChart,
  DistributionChart,
  statusColors,
} from "./PerformanceChart";
export type { ChartDataPoint } from "./PerformanceChart";
export { StudentList, StudentChip } from "./StudentList";
export type { StudentInfo } from "./StudentList";
export { TeacherCard, TeacherGrid } from "./TeacherCard";
export type { TeacherInfo } from "./TeacherCard";
export { ReferenceSection, ReferenceDisplay } from "./ReferenceSection";
export type { ReferenceData, CalculationStep } from "./ReferenceSection";
export { SourceBadge, getSourceType } from "./SourceBadge";
export type { SourceType } from "./SourceBadge";
export { AccessDenied, AccessRestrictedBanner } from "./AccessDenied";
export { UserAvatar } from "./UserAvatar";
export type { UserAvatarProps } from "./UserAvatar";
export { UserPhotoSheet } from "./UserPhotoSheet";
export type { UserPhotoSheetProps } from "./UserPhotoSheet";
