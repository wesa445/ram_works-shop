// Значения правятся панелью в браузере и переписывают этот файл.
// Подобраны на глаз в панели под референсы (Control): тёмный зал, светящаяся пыльная комната.
// Точка отсчёта — калибровка по рендеру Cycles замером зон кадра: ambient 0.28, lightScale 0.0008,
// ceiling 1, без дымки и ореола. Физичные ambient 0.16 и lightScale 1/683 рендеру не соответствуют.
export const PARAMS = {
  ambient: 0.07,
  lightScale: 0.00025,
  fill: 40,
  focusFill: 150,
  shadowSoftness: 2.5,
  swayAmount: 0.02,
  swaySpeed: 0.08,
  focusZoom: 1.2,
  ceiling: 1.45,
  haze: 0.013,
  hazeGlow: 2.05,
  dust: 0.05,
  bloom: 0.25,
  bloomThreshold: 1.55,
  cool: 0.8,
  vignette: 0.7,
  grain: 0.015,
}
