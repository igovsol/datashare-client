export { default as WidgetEmpty } from './WidgetEmpty'
export { default as WidgetFileBarometer } from './WidgetFileBarometer'
export { default as WidgetCreationDateOverTime } from './WidgetCreationDateOverTime.js'
export { default as WidgetText } from './WidgetText'

export default [
  { card: true, cols: 8, type: 'WidgetText', title: 'Insights' },
  { card: true, cols: 4, type: 'WidgetFileBarometer' },
  { card: true, cols: 12, type: 'WidgetCreationDateOverTime', title: 'Creation date of documents over time' }
]
