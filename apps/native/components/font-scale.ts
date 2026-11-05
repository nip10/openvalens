// No imports, so components can use these without loading bloom (and React
// Native) in their unit tests.

/**
 * How far display type (titles and big figures in Fraunces) grows with the
 * phone's text size. It starts large, so uncapped it broke words mid-way on a
 * 375 pt phone at the accessibility sizes (#379); body text scales fully.
 */
export const DISPLAY_MAX_FONT_SCALE = 1.4;

/**
 * Labels inside controls with a set height (heroui buttons and chips): past
 * this they were cut through the middle at the accessibility sizes (#379).
 */
export const CONTROL_MAX_FONT_SCALE = 1.4;
