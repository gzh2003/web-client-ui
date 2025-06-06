import Log from '@deephaven/log';
import {
  assertNotNull,
  ColorUtils,
  requestParentResponse,
} from '@deephaven/utils';
import { themeDark } from './theme-dark';
import { themeLight } from './theme-light';
import {
  DEFAULT_DARK_THEME_KEY,
  DEFAULT_LIGHT_THEME_KEY,
  DEFAULT_PRELOAD_DATA_VARIABLES,
  type BaseThemeKey,
  type ThemeData,
  type ThemePreloadData,
  type CssVariableStyleContent,
  type ThemePreloadColorVariable,
  type ThemeRegistrationData,
  THEME_CACHE_LOCAL_STORAGE_KEY,
  SVG_ICON_MANUAL_COLOR_MAP,
  type ThemeCssVariableName,
  type ThemeIconsRequiringManualColorChanges,
  THEME_KEY_OVERRIDE_QUERY_PARAM,
  EXTERNAL_THEME_KEY,
  type ExternalThemeData,
  MSG_REQUEST_GET_THEME,
  type ThemeCssColorVariableName,
  TRANSPARENT_PRELOAD_DATA_VARIABLES,
  PRELOAD_TRANSPARENT_THEME_QUERY_PARAM,
} from './ThemeModel';

const log = Log.module('ThemeUtils');

export const CSS_VAR_EXPRESSION_PREFIX = 'var(--';
export const DH_VAR_PREFIX = '--dh-color-';
export const TMP_CSS_PROP_PREFIX = 'dh-tmp';
export const NON_WHITESPACE_REGEX = /\S/;
export const WHITESPACE_REGEX = /\s/;

export const DH_CSS_VAR_NAME_REGEXP = /^--dh-color-[a-z0-9_-]+$/;

export type VarExpressionResolver = (varExpression: string) => string;

/**
 * Resolves the current values of CSS variables we want to preload. Preloading
 * happens before themes are fully loaded so that we can style things like the
 * loading spinner and background color which are shown to the user early on in
 * the app lifecycle.
 * @defaultPreloadValues Default values to use if a preload variable is not set.
 */
export function calculatePreloadStyleContent(
  defaultPreloadValues: Record<string, string>
): CssVariableStyleContent {
  const resolveVar = createCssVariableResolver(
    document.body,
    defaultPreloadValues
  );

  // Calculate the current preload variables. If the variable is not set, use
  // the default value.
  const pairs = Object.keys(defaultPreloadValues).map(
    key => `${key}:${resolveVar(key as ThemePreloadColorVariable)}`
  );

  return `:root{${pairs.join(';')}}`;
}

/**
 * Create a resolver function for calculating the value of a css variable based
 * on a given element's computed style. If the variable resolves to '', we check
 * `defaultValues` for a default value, and if one does not exist,
 * return ''.
 * @param el Element to resolve css variables against
 * @param defaultValues Default values to use if a variable is not set.
 */
export function createCssVariableResolver(
  el: Element,
  defaultValues: Record<string, string>
): (varName: ThemeCssVariableName) => string {
  const computedStyle = getComputedStyle(el);

  /**
   * Resolve the given css variable name to a value. If the variable is not set,
   * return the default preload value or '' if one does not exist.
   */
  return function cssVariableResolver(varName: ThemeCssVariableName): string {
    const value = computedStyle.getPropertyValue(varName);

    if (value !== '') {
      return value;
    }

    return defaultValues[varName as ThemePreloadColorVariable] ?? '';
  };
}

/**
 * Create a style tag containing preload css variables and add to the head.
 * @param id The id of the style tag
 * @param preloadStyleContent The css variable content to add to the style tag
 */
export function createPreloadStyleElement(
  id: `theme-preload-${string}`,
  preloadStyleContent: CssVariableStyleContent
): void {
  const style = document.createElement('style');
  style.id = id;
  style.innerHTML = preloadStyleContent;
  document.head.appendChild(style);
}

/**
 * Extracts all css variable expressions from the given record and returns
 * a set of unique expressions.
 * @param record The record to extract css variable expressions from
 */
export function extractDistinctCssVariableExpressions(
  record: Record<string, string>
): Set<string> {
  const set = new Set<string>();

  Object.values(record).forEach(value => {
    getExpressionRanges(value).forEach(([start, end]) => {
      const expression = value.substring(start, end + 1);

      if (expression.includes(CSS_VAR_EXPRESSION_PREFIX)) {
        set.add(expression);
      }
    });
  });

  return set;
}

/**
 * Returns an array of the active themes. The first item will always be one
 * of the base themes. Optionally, the second item will be a custom theme.
 */
export function getActiveThemes(
  themeKey: string,
  themeRegistration: ThemeRegistrationData
): [ThemeData] | [ThemeData, ThemeData] {
  const custom = themeRegistration.custom.find(
    theme => theme.themeKey === themeKey
  );

  const baseThemeKey = custom?.baseThemeKey ?? themeKey;

  let base = themeRegistration.base.find(
    theme => theme.themeKey === baseThemeKey
  );

  if (base == null) {
    log.error(
      `No registered base theme found for theme key: '${baseThemeKey}'`,
      'Registered:',
      themeRegistration.base.map(theme => theme.themeKey),
      themeRegistration.custom.map(theme => theme.themeKey)
    );
    base = themeRegistration.base.find(
      theme => theme.themeKey === DEFAULT_DARK_THEME_KEY
    );

    assertNotNull(
      base,
      `Default base theme '${DEFAULT_DARK_THEME_KEY}' is not registered`
    );
  }

  log.debug('Applied themes:', base.themeKey, custom?.themeKey);

  return custom == null ? [base] : [base, custom];
}

/**
 * Get default base theme data.
 */
export function getDefaultBaseThemes(): ThemeData[] {
  return [
    {
      name: 'Default Dark',
      themeKey: DEFAULT_DARK_THEME_KEY,
      styleContent: themeDark,
    },
    // The ThemePicker shows whenever more than 1 theme is available. Disable
    // light theme for now to keep the picker hidden until it is fully
    // implemented by #1539.
    {
      name: 'Default Light',
      themeKey: DEFAULT_LIGHT_THEME_KEY,
      styleContent: themeLight,
    },
  ];
}

/**
 * Get the default selected theme key. Precedence is:
 * 1. Theme key override query parameter
 * 2. Theme key from preload data
 * 3. Default dark theme key
 * @returns The default selected theme key
 */
export function getDefaultSelectedThemeKey(): string {
  return (
    getThemeKeyOverride() ??
    getThemePreloadData()?.themeKey ??
    DEFAULT_DARK_THEME_KEY
  );
}

/**
 * Derive unique theme key from plugin root path and theme name.
 * @param pluginName The root path of the plugin
 * @param themeName The name of the theme
 */
export function getThemeKey(pluginName: string, themeName: string): string {
  return `${pluginName}_${themeName}`;
}

/**
 * A theme key override can be set via a query parameter to force a specific
 * theme selection. Useful for embedded widget scenarios that don't expose the
 * theme selector.
 */
export function getThemeKeyOverride(): string | null {
  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get(THEME_KEY_OVERRIDE_QUERY_PARAM);
}

/**
 * Get the preload data from local storage or null if it does not exist or is
 * invalid
 */
export function getThemePreloadData(): ThemePreloadData | null {
  const data = localStorage.getItem(THEME_CACHE_LOCAL_STORAGE_KEY);

  try {
    return data == null ? null : JSON.parse(data);
  } catch {
    // ignore
  }

  return null;
}

/**
 * Identifies start and end indices of any top-level expressions in the given
 * string.
 *
 * e.g.
 * getExpressionRanges('var(--aaa-aa) #fff var(--bbb-bb)')
 * yields:
 * [
 *   [0, 12],  // 'var(--aaa-aa)'
 *   [14, 17]  // '#fff'
 *   [19, 31], // 'var(--bbb-bb)'
 * ]
 *
 * In cases where there are nested expressions, only the indices of the outermost
 * expression will be included.
 *
 * e.g.
 * getExpressionRanges('var(--ccc-cc, var(--aaa-aa, green)) var(--bbb-bb)')
 * yields:
 * [
 *   [0, 34],  // 'var(--ccc-cc, var(--aaa-aa, green))'
 *   [36, 48], // 'var(--bbb-bb)'
 * ]
 * @param value The string to search for expressions
 * @returns An array of [start, end] index pairs for each expression
 */
export function getExpressionRanges(value: string): [number, number][] {
  const ranges: [number, number][] = [];

  let start = NON_WHITESPACE_REGEX.exec(value)?.index ?? 0;
  let parenLevel = 0;

  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '(') {
      parenLevel += 1;
    } else if (value[i] === ')') {
      parenLevel -= 1;
    }

    if (
      i === value.length - 1 ||
      (WHITESPACE_REGEX.test(value[i + 1]) && parenLevel === 0)
    ) {
      ranges.push([start, i]);

      while (i < value.length - 1 && WHITESPACE_REGEX.test(value[i + 1])) {
        i += 1;
      }

      start = i + 1;
    }
  }

  if (parenLevel !== 0) {
    log.error('Unbalanced parentheses in css var expression', value);
    return [];
  }

  return ranges;
}

/**
 * Check if the given theme key is one of the base themes.
 * @param themeKey The theme key to check
 * @returns True if the theme key is a base theme key, false otherwise
 */
export function isBaseThemeKey(themeKey: string): themeKey is BaseThemeKey {
  return [DEFAULT_DARK_THEME_KEY, DEFAULT_LIGHT_THEME_KEY].includes(themeKey);
}

/**
 * Determine if a given object is a `ExternalThemeData` object.
 * @param maybeExternalThemeData An object that may or may not be a `ExternalThemeData`
 * @returns True if the object is a `ExternalThemeData`, false otherwise
 */
export function isExternalThemeData(
  maybeExternalThemeData: unknown
): maybeExternalThemeData is ExternalThemeData {
  if (
    typeof maybeExternalThemeData !== 'object' ||
    maybeExternalThemeData == null
  ) {
    return false;
  }

  return (
    'name' in maybeExternalThemeData &&
    typeof maybeExternalThemeData.name === 'string' &&
    'cssVars' in maybeExternalThemeData &&
    typeof maybeExternalThemeData.cssVars === 'object' &&
    maybeExternalThemeData.cssVars != null
  );
}

/**
 * Check if the current URL specifies an external theme key override.
 * @returns True if the external theme key override is set, false otherwise
 */
export function isExternalThemeEnabled(): boolean {
  const searchParams = new URLSearchParams(window.location.search);
  return (
    searchParams.get(THEME_KEY_OVERRIDE_QUERY_PARAM) === EXTERNAL_THEME_KEY
  );
}

/**
 * Check if PRELOAD_TRANSPARENT_THEME_QUERY_PARAM query parameter is set to true.
 * @returns True if the preload transparent theme query parameter is set, false
 * otherwise
 */
export function isPreloadTransparentTheme(): boolean {
  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get(PRELOAD_TRANSPARENT_THEME_QUERY_PARAM) === 'true';
}

/**
 * Validate that a given CSS variable name / value pair is a valid Deephaven
 * color variable.
 * @param name The name of the CSS variable to validate, e.g. '--dh-color-primary'
 * @param value The value of the CSS color to validate
 * @returns True if the name is a valid Deephaven color variable and the value
 * is a valid CSS color, false otherwise
 */
export function isValidColorVar(
  name: string,
  value: string
): name is ThemeCssColorVariableName {
  return DH_CSS_VAR_NAME_REGEXP.test(name) && CSS.supports('color', value);
}

/**
 * Parse external theme data into a `ThemeData` object. Invalid CSS color variable
 * pairs are excluded from the resulting `ThemeData` object.
 * @param externalThemeData The external theme data to parse
 * @returns A `ThemeData` object representing the external theme
 */
export function parseExternalThemeData({
  baseThemeKey = DEFAULT_DARK_THEME_KEY,
  name,
  cssVars,
}: ExternalThemeData): ThemeData {
  const toExpression = ([varName, varValue]: [string, string]) =>
    isValidColorVar(varName, varValue) ? `${varName}:${varValue};` : null;

  const sanitized = Object.entries(cssVars)
    .map(toExpression)
    .filter((str): str is string => str != null);

  const styleContent =
    sanitized.length === 0 ? '' : `:root{${sanitized.join('')}}`;

  return {
    baseThemeKey,
    themeKey: EXTERNAL_THEME_KEY,
    name,
    styleContent,
  };
}

/**
 * Replace the `fill='...'` attribute in the given SVG content with the given
 * color string.
 * @param svgContent Inline SVG content to replace the fill color in
 * @param fillColor The color to replace the fill color with
 */
export function replaceSVGFillColor(
  svgContent: string,
  fillColor: string
): string {
  return svgContent.replace(
    /fill='.*?'/,
    `fill='${encodeURIComponent(fillColor)}'`
  );
}

/**
 * Request theme data from the parent window.
 * @returns A promise that resolves to the external theme data
 * @throws Error if the response is not a valid `ExternalThemeData`
 */
export async function requestExternalThemeData(): Promise<ExternalThemeData> {
  const result = await requestParentResponse(MSG_REQUEST_GET_THEME);

  if (!isExternalThemeData(result)) {
    throw new Error(
      `Unexpected external theme data response: ${JSON.stringify(result)}`
    );
  }

  return result;
}

/**
 * Make a copy of the given object replacing any css variable expressions
 * contained in its prop values with values resolved from the given HTML element.
 * Variables that resolve to color strings will also be normalized to 8 digit
 * hex values (or optionally 6 digit hex if `isAlphaOptional` is true).
 *
 * Note that the browser will force a reflow when calling `getComputedStyle` if
 * css properties have changed. In order to avoid a reflow for every property
 * check we use distinct setup, resolve / normalize, and cleanup passes:
 * 1. Setup - Create a tmp element and set all css props we want to evaluate
 * 2. Resolve / Normalize - Evaluate all css props via `getPropertyValue` calls
 *    and replace the original expressions with resolved values. Also normalize
 *    css colors to rgb/a.
 * 3. Cleanup - Remove the tmp element
 * @param record An object whose values may contain css var expressions
 * @param targetElement The element to resolve css variables against. Defaults
 * to document.body
 * @param isAlphaOptional If true, the alpha value will be dropped from resolved
 * 8 character hex colors if it is 'ff'. Defaults to false.
 */
export function resolveCssVariablesInRecord<T extends Record<string, string>>(
  record: T,
  targetElement: HTMLElement = document.body,
  isAlphaOptional = false
): T {
  const perfStart = performance.now();

  // Add a temporary div to attach temp css variables to
  const tmpPropEl = document.createElement('div');
  tmpPropEl.style.display = 'none';

  const recordArray = Object.entries(record);
  recordArray.forEach(([, value], i) => {
    tmpPropEl.style.setProperty(`--${TMP_CSS_PROP_PREFIX}-${i}`, value);
    // faster to create these now all at once, even if we don't use them all
    // since the parent isn't added yet to the DOM
    const el = document.createElement('div');
    // use background color instead of color to avoid inherited values
    el.style.backgroundColor = value;
    tmpPropEl.appendChild(el);
  });

  // append only once to avoid multiple re-layouts
  // must be part of DOM to get computed color
  targetElement.appendChild(tmpPropEl);
  const tempPropElComputedStyle = window.getComputedStyle(tmpPropEl);

  const result = {} as T;
  recordArray.forEach(([key, value], i) => {
    // resolves any variables in the expression
    let resolved = tempPropElComputedStyle.getPropertyValue(
      `--${TMP_CSS_PROP_PREFIX}-${i}`
    );

    const containsCssVar = value.includes(CSS_VAR_EXPRESSION_PREFIX);
    const isColor = CSS.supports('color', resolved);

    if (
      // only try to normalize non-hex strings that are valid colors
      // otherwise non-colors will be made #00000000
      isColor &&
      !/^#[0-9A-F]{6}[0-9a-f]{0,2}$/i.test(resolved)
    ) {
      // getting the computed background color is necessary
      // because resolved can still contain a color-mix() function
      const el = tmpPropEl.children[i] as HTMLDivElement;
      const computedStyle = window.getComputedStyle(el);
      const color = computedStyle.getPropertyValue('background-color');
      // convert color to hex, which is what monaco and plotly require
      resolved = ColorUtils.normalizeCssColor(color, isAlphaOptional);
    }
    (result as Record<string, string>)[key] =
      containsCssVar || isColor ? resolved : value;
  });

  // Remove the temporary div
  tmpPropEl.remove();

  log.debug('Resolved css variables', performance.now() - perfStart, 'ms');

  return result;
}

/**
 * Resolve css variable expressions in the given string using the
 * given resolver and replace the original expressions with the resolved values.
 *
 * @param resolver Function that can resolve a css variable expression
 * @param value Value that may contain css variable expressions
 */
export function resolveCssVariablesInString(
  resolver: VarExpressionResolver,
  value: string
): string {
  const result: string[] = [];
  let i = 0;
  getExpressionRanges(value).forEach(([start, end]) => {
    if (i < start) {
      result.push(value.substring(i, start));
      i += start - i;
    }

    const expression = value.substring(start, end + 1);

    result.push(
      expression.includes(CSS_VAR_EXPRESSION_PREFIX)
        ? resolver(expression)
        : expression
    );

    i += end - start + 1;
  });

  if (result.length === 0) {
    return value;
  }

  return result.join('');
}

/**
 * Store theme preload data in local storage.
 * @param preloadData The preload data to set
 */
export function setThemePreloadData(preloadData: ThemePreloadData): void {
  localStorage.setItem(
    THEME_CACHE_LOCAL_STORAGE_KEY,
    JSON.stringify(preloadData)
  );
}

/**
 * Preload minimal theme variables from the cache.
 * @defaultPreloadValues Optional default values to use if a preload variable is not set.
 */
export function preloadTheme(
  defaultPreloadValues: Record<string, string> = DEFAULT_PRELOAD_DATA_VARIABLES
): void {
  // In certain cases we may want to preload a transparent theme to allow the
  // parent container to show through. For example, when a parent Window is
  // providing a theme via `postMessage` apis, we may not have enough information
  // to properly preload the theme, so we can just preload a transparent
  // theme and let the parent container show through until `postMessage`
  // communication is complete.
  if (isPreloadTransparentTheme()) {
    createPreloadStyleElement(
      'theme-preload-transparent',
      calculatePreloadStyleContent(TRANSPARENT_PRELOAD_DATA_VARIABLES)
    );
    return;
  }

  const previousPreloadStyleContent =
    getThemePreloadData()?.preloadStyleContent;

  const defaultPreloadStyleContent =
    calculatePreloadStyleContent(defaultPreloadValues);

  log.debug('Preloading theme content:', {
    defaultPreloadStyleContent,
    previousPreloadStyleContent,
  });

  createPreloadStyleElement(
    'theme-preload-defaults',
    defaultPreloadStyleContent
  );

  // Any preload variables that were saved by last theme load should override
  // the defaults
  if (previousPreloadStyleContent != null) {
    createPreloadStyleElement(
      'theme-preload-previous',
      previousPreloadStyleContent
    );
  }
}

/**
 * Inline SVGs cannot depend on dynamic CSS variables, so we have to statically
 * update them if we want to change their color.
 *
 * This function:
 * 1. Clears any previous overrides
 * 2. Resolves CSS variables containing inline SVG urls
 * 3. Resolves mapped color variables and replaces the `fill='...'` attribute with the result
 * 4. Sets the original CSS variable to the new replaced value
 *
 * Note that it is preferable to use inline SVGs as background-mask values and
 * just change the background color instead of relying on this util, but this
 * is not always possible. e.g. <select> elements don't support pseudo elements,
 * so there's not a good way to set icons via masks.
 * @param defaultValues Default values to use if a variable is not set.
 */
export function overrideSVGFillColors(
  defaultValues: Record<string, string>
): void {
  const resolveVar = createCssVariableResolver(document.body, defaultValues);

  Object.entries(SVG_ICON_MANUAL_COLOR_MAP).forEach(([key, value]) => {
    // Clear any previous override so that our variables get resolved against the
    // actual svg content provided by the active themes and not from a previous
    // override
    document.body.style.removeProperty(key);

    const svgContent = resolveVar(key as ThemeIconsRequiringManualColorChanges);
    const fillColor = resolveVar(value as ThemePreloadColorVariable);

    const newSVGContent = replaceSVGFillColor(svgContent, fillColor);

    // This will take precedence over any values for the variable provided by
    // the active themes
    document.body.style.setProperty(key, newSVGContent);
  });
}
