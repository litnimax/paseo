import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";

/**
 * Whether sidebar workspace rows are driven by touch rather than a pointer. Touch rows show
 * their kebab permanently and never get hover-only affordances, so the row renderers and the
 * settings that configure those affordances all have to agree on this one answer.
 */
export function useIsSidebarTouchRow(): boolean {
  const isCompact = useIsCompactFormFactor();
  return isNative || isCompact;
}
