import escapeRegExp from 'lodash/escapeRegExp'
import identity from 'lodash/identity'
import map from 'lodash/map'
import sortBy from 'lodash/sortBy'
import takeRight from 'lodash/takeRight'
import zip from 'lodash/zip'
import cheerio from 'cheerio'

export function slugger (value = '') {
  return value
    .toLowerCase()
    .trim()
    .replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g, '')
    .replace(/\s/g, '-')
}

export function replaceInChildNodes (element, needle, replacement) {
  if (element.type === 'text') {
    const index = element.parent.children.indexOf(element)
    const node = cheerio(element.parent.children[index])
    node.replaceWith(element.nodeValue.replace(needle, replacement))
  } else if (element.type === 'tag') {
    element.childNodes.forEach(child => replaceInChildNodes(child, needle, replacement))
  } else {
    element.toArray().forEach(child => replaceInChildNodes(child, needle, replacement))
  }
}

export function addLocalSearchMarks (content, localSearchTerm = { label: '' }) {
  const escapedLocalSearchTerm = localSearchTerm.regex ? localSearchTerm.label : escapeRegExp(localSearchTerm.label)
  const regex = new RegExp('(?![^<]*>)' + escapedLocalSearchTerm, 'gi')
  const localSearchOccurrences = (content.match(regex) || []).length
  const localSearchIndex = Number(!!localSearchOccurrences)

  try {
    if (localSearchOccurrences === 0) throw new Error()

    const needle = RegExp(`(${escapedLocalSearchTerm})`, 'gim')
    const dom = cheerio.load(content || '<div></div>')
    if (!dom) throw new Error()

    replaceInChildNodes(dom('body'), needle, '<mark class="local-search-term">$1</mark>')

    return {
      content: dom('body').html(),
      localSearchIndex,
      localSearchOccurrences
    }
  // Silently fails
  } catch (error) {
    return { content, localSearchIndex, localSearchOccurrences }
  }
}

export function sliceIndexes (str, indexes) {
  if (str.length === 0) return []
  let orderedIndexes = Array.from(new Set(indexes)).sort((a, b) => a - b)
  let result = []
  let currentIndex = 0
  for (let index of orderedIndexes) {
    if (index >= 0 && index < str.length) {
      let items = str.substring(currentIndex, index)
      result.push(items)
      currentIndex = index
    }
  }
  result.push(str.substring(currentIndex))
  return result
}

export function highlight (str = '', marks = [], markFun = (m => `<mark>${m.content}</mark>`), restFun = identity, contentFun = (m => m.content)) {
  const sortedMarks = sortBy(marks, m => m.index)
  let docContentSlices = sliceIndexes(str, map(sortedMarks, m => m.index))
  let docContentMarked = map(zip(takeRight(docContentSlices, sortedMarks.length), sortedMarks), ([slice = '', mark]) => {
    return markFun(mark) + restFun(slice.substring(contentFun(mark).length))
  })
  return docContentSlices[0] + docContentMarked.join('')
}
