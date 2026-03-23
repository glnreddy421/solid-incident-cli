/** Passed into panel renderers for BYO follow-up picker state. */
export interface TuiLayoutContext {
  byoFollowUpAvailable: boolean;
  followUpPickerOpen: boolean;
}

export const DEFAULT_TUI_LAYOUT_CONTEXT: TuiLayoutContext = {
  byoFollowUpAvailable: false,
  followUpPickerOpen: false,
};
