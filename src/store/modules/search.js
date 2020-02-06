import elasticsearch from '@/api/elasticsearch'
import EsDocList from '@/api/resources/EsDocList'
import { getDocumentTypeLabel, getExtractionLevelTranslationKey } from '@/utils/utils'
import settings from '@/utils/settings'
import { isNarrowScreen } from '@/utils/screen'
import * as filterTypes from '@/store/filters'
import { namedEntityCategoryTranslation, starredLabel } from '@/store/filtersStore'
import Api from '@/api'
import types from '@/utils/types.json'

import lucene from 'lucene'
import moment from 'moment'
import castArray from 'lodash/castArray'
import compact from 'lodash/compact'
import concat from 'lodash/concat'
import difference from 'lodash/difference'
import each from 'lodash/each'
import endsWith from 'lodash/endsWith'
import escapeRegExp from 'lodash/escapeRegExp'
import filterCollection from 'lodash/filter'
import find from 'lodash/find'
import findIndex from 'lodash/findIndex'
import get from 'lodash/get'
import has from 'lodash/has'
import includes from 'lodash/includes'
import isInteger from 'lodash/isInteger'
import isString from 'lodash/isString'
import join from 'lodash/join'
import keys from 'lodash/keys'
import map from 'lodash/map'
import omit from 'lodash/omit'
import orderBy from 'lodash/orderBy'
import range from 'lodash/range'
import random from 'lodash/random'
import reduce from 'lodash/reduce'
import toLower from 'lodash/toLower'
import uniq from 'lodash/uniq'
import values from 'lodash/values'
import Vue from 'vue'

export const api = new Api()

export function initialState () {
  return {
    query: '',
    from: 0,
    size: 25,
    globalSearch: true,
    filters: [
      { type: 'FilterStarred', options: ['starred', '_id', 'star', false, item => get(starredLabel, item.key, '')] },
      { type: 'FilterText', options: ['tags', 'tags', 'tags', true] },
      { type: 'FilterText', options: ['contentType', 'contentType', 'file', true, item => getDocumentTypeLabel(item.key), query => map(types, (item, key) => { if (toLower(item.label).includes(query)) return key })] },
      { type: 'FilterDateRange', options: ['creationDate', 'metadata.tika_metadata_creation_date', 'calendar-alt', false, item => isInteger(item.key) ? moment(item.key).locale(localStorage.getItem('locale')).format('L') : item.key] },
      { type: 'FilterText', options: ['language', 'language', 'language', false, item => `filter.lang.${item.key}`] },
      { type: 'FilterNamedEntity', options: ['namedEntityPerson', 'byMentions', null, true, namedEntityCategoryTranslation.namedEntityPerson] },
      { type: 'FilterNamedEntity', options: ['namedEntityOrganization', 'byMentions', null, true, namedEntityCategoryTranslation.namedEntityOrganization] },
      { type: 'FilterNamedEntity', options: ['namedEntityLocation', 'byMentions', null, true, namedEntityCategoryTranslation.namedEntityLocation] },
      { type: 'FilterPath', options: ['path', 'byDirname', 'hdd', false] },
      { type: 'FilterText', options: ['extractionLevel', 'extractionLevel', 'paperclip', false, item => getExtractionLevelTranslationKey(item.key)] },
      { type: 'FilterDate', options: ['indexingDate', 'extractionDate', 'calendar-plus', false, item => item.key_as_string] }
    ],
    values: {},
    reversed: ['language'],
    sort: settings.defaultSearchSort,
    field: settings.defaultSearchField,
    response: EsDocList.none(),
    isReady: true,
    error: null,
    index: '',
    showFilters: true,
    starredDocuments: [],
    // Different default layout for narrow screen
    layout: isNarrowScreen() ? 'table' : 'list',
    isDownloadAllowed: false
  }
}

export const state = initialState()

export const getters = {
  instantiateFilter (state) {
    return ({ type, options }) => {
      const Type = filterTypes[type]
      const filter = new Type(...options)
      // Bind current state to be able to retrieve its values
      filter.bindState(state)
      // Return the instance
      return filter
    }
  },
  instantiatedFilters (state, getters) {
    return state.filters.map(filter => {
      return getters.instantiateFilter(filter)
    })
  },
  getFilter (state, getters) {
    return predicate => find(getters.instantiatedFilters, predicate)
  },
  getFields (state) {
    return () => find(settings.searchFields, { key: state.field }).fields
  },
  hasFilterValue (state, getters) {
    return item => !!find(state.instantiatedFilters, filter => {
      return filter.name === item.name && filter.values.indexOf(item.value) > -1
    })
  },
  hasFilterValues (state, getters) {
    return name => !!find(getters.instantiatedFilters, filter => {
      return filter.name === name && filter.values.length > 0
    })
  },
  isFilterReversed (state, getters) {
    return name => {
      return !!find(getters.instantiatedFilters, filter => {
        return filter.name === name && filter.reverse
      })
    }
  },
  activeFilters (state, getters) {
    return filterCollection(getters.instantiatedFilters, f => f.hasValues())
  },
  findFilter (state, getters) {
    return name => find(getters.instantiatedFilters, { name })
  },
  filterValuesAsRouteQuery (state, getters) {
    return () => {
      return reduce(keys(state.values), (memo, name) => {
        // We need to look for the filter's definition in order to us its `id`
        // as key for the URL params. This was we track configured filter instead
        // of arbitrary values provided by the user. This allow to retrieve special
        // behaviors depending on the filter definition.
        const filter = find(getters.instantiatedFilters, { name })
        // We don't add filterValue that match with any existing filters
        // defined in the `aggregation` store.
        if (filter && filter.values.length > 0) {
          const key = filter.reverse ? `f[-${filter.name}]` : `f[${filter.name}]`
          memo[key] = filter.values
        }
        return memo
      }, {})
    }
  },
  toRouteQuery (state, getters) {
    return () => ({
      q: state.query,
      from: state.from,
      size: state.size,
      sort: state.sort,
      index: state.index,
      field: state.field,
      ...getters.filterValuesAsRouteQuery()
    })
  },
  toRouteQueryWithStamp (state, getters) {
    return () => ({
      ...getters.toRouteQuery(),
      // A random string of 6 chars
      stamp: String.fromCharCode.apply(null, range(6).map(() => random(97, 122)))
    })
  },
  retrieveQueryTerms (state) {
    let terms = []
    function getTerm (query, path, start, operator) {
      const term = get(query, join([path, 'term'], '.'), '')
      const field = get(query, join([path, 'field'], '.'), '')
      const prefix = get(query, join([path, 'prefix'], '.'), '')
      const regex = get(query, join([path, 'regex'], '.'), false)
      const negation = ['-', '!'].includes(prefix) || start === 'NOT' || endsWith(operator, 'NOT')
      if (term !== '*' && term !== '' && !includes(map(terms, 'label'), term)) {
        terms = concat(terms, { field: field === '<implicit>' ? '' : field, label: term.replace('\\', ''), negation, regex })
      }
      if (term === '' && has(query, join([path, 'left'], '.'))) {
        retTerms(get(query, 'left'))
      }
    }
    function retTerms (query, operator = null) {
      getTerm(query, 'left', get(query, 'start', null), operator)
      if (get(query, 'right.left', null) === null) {
        getTerm(query, 'right', null, get(query, 'operator', null))
      } else {
        retTerms(get(query, 'right'), get(query, 'operator', null))
      }
    }
    try {
      retTerms(lucene.parse(state.query.replace('\\@', '@')))
      return terms
    } catch (_) {
      return []
    }
  },
  retrieveContentQueryTerms (state, getters) {
    const fields = ['', 'content']
    return filterCollection(getters.retrieveQueryTerms, item => fields.includes(item.field))
  },
  retrieveContentQueryTermsInContent (state, getters) {
    return (text, field) => getters.retrieveContentQueryTerms.map(term => {
      const regex = new RegExp(term.regex ? term.label : escapeRegExp(term.label), 'gi')
      term[field] = (text.match(regex) || []).length
      return term
    })
  },
  retrieveContentQueryTermsInDocument (state, getters) {
    return document => {
      map(['content', 'metadata', 'tags'], field => {
        let extractedField = get(document, ['source', field], '')
        if (isString(extractedField)) extractedField = castArray(extractedField)
        const text = join(compact(values(extractedField)), ' ')
        getters.retrieveContentQueryTermsInContent(text, field)
      })
      return orderBy(getters.retrieveContentQueryTerms, ['content'], ['desc']).sort(a => a.content === 0 && a.metadata > 0)
    }
  },
  sortBy (state) {
    return find(settings.searchSortFields, { name: state.sort })
  }
}

export const mutations = {
  reset (state, excludedKeys = ['index', 'showFilters', 'layout', 'size', 'sort']) {
    const s = initialState()
    Object.keys(s).forEach(key => {
      if (excludedKeys.indexOf(key) === -1) {
        state[key] = s[key]
      }
    })
    const existingFilter = find(state.filters, { name: 'starred' })
    if (existingFilter) {
      existingFilter.starredDocuments = state.starredDocuments
    }
  },
  setGlobalSearch (state, globalSearch) {
    state.globalSearch = globalSearch
  },
  query (state, query) {
    state.query = query
  },
  from (state, from) {
    state.from = Number(from)
  },
  size (state, size) {
    state.size = Number(size)
  },
  sort (state, sort) {
    state.sort = sort
  },
  isReady (state, isReady = !state.isReady) {
    state.isReady = isReady
  },
  error (state, error = null) {
    state.error = error
  },
  index (state, index) {
    state.index = index
  },
  layout (state, layout) {
    state.layout = layout
  },
  field (state, field) {
    const fields = settings.searchFields.map(field => field.key)
    state.field = fields.indexOf(field) > -1 ? field : settings.defaultSearchField
  },
  isDownloadAllowed (state, isDownloadAllowed) {
    state.isDownloadAllowed = isDownloadAllowed
  },
  starredDocuments (state, starredDocuments) {
    state.starredDocuments = starredDocuments
  },
  buildResponse (state, raw) {
    state.isReady = true
    state.response = new EsDocList(raw)
  },
  addFilterValue (state, filter) {
    // We cast the new filter values to allow several new values at the same time
    const values = castArray(filter.value)
    // Look for existing values for this name
    const existingValues = get(state, ['values', filter.name], [])
    Vue.set(state.values, filter.name, uniq(existingValues.concat(values)))
  },
  setFilterValue (state, filter) {
    Vue.set(state.values, filter.name, castArray(filter.value))
  },
  addFilterValues (state, { filter, values }) {
    const existingValues = get(state, ['values', filter.name], [])
    Vue.set(state.values, filter.name, uniq(existingValues.concat(castArray(values))))
  },
  removeFilterValue (state, filter) {
    // Look for existing values for this name
    const existingValues = get(state, ['values', filter.name], [])
    // Filter the values for this name to remove the given value
    Vue.set(state.values, filter.name, filterCollection(existingValues, value => value !== filter.value))
  },
  removeFilter (state, name) {
    const index = findIndex(state.filters, ({ options }) => options[0] === name)
    Vue.delete(state.filters, index)
    if (name in state.values) {
      Vue.delete(state.values, name)
    }
  },
  addFilter (state, { type, options }) {
    state.filters.push({ type, options })
  },
  excludeFilter (state, name) {
    if (state.reversed.indexOf(name) === -1) {
      state.reversed.push(name)
    }
  },
  includeFilter (state, name) {
    Vue.delete(state.reversed, state.reversed.indexOf(name))
  },
  toggleFilter (state, name) {
    if (state.reversed.indexOf(name) > -1) {
      Vue.delete(state.reversed, state.reversed.indexOf(name))
    } else {
      state.reversed.push(name)
    }
  },
  resetFilterValues (state, name) {
    Vue.set(state.values, name, [])
  },
  toggleFilters (state, toggler = !state.showFilters) {
    Vue.set(state, 'showFilters', toggler)
  },
  pushFromStarredDocuments (state, documentIds) {
    state.starredDocuments = uniq(concat(state.starredDocuments, documentIds))
  },
  removeFromStarredDocuments (state, documentIds) {
    state.starredDocuments = difference(state.starredDocuments, documentIds)
  }
}

export const actions = {
  reset ({ commit, dispatch }, excludedKeys) {
    commit('reset', excludedKeys)
    return dispatch('query')
  },
  async refresh ({ state, commit, getters }, updateIsReady = true) {
    commit('isReady', !updateIsReady)
    commit('error', null)
    try {
      const raw = await elasticsearch.searchDocs(state.index, state.query, getters.instantiatedFilters, state.from, state.size, state.sort, getters.getFields())
      commit('buildResponse', raw)
      return raw
    } catch (error) {
      commit('isReady', true)
      commit('error', error)
      throw error
    }
  },
  query ({ state, commit, getters, dispatch }, queryOrParams = { index: state.index, query: state.query, from: state.from, size: state.size, sort: state.sort, field: state.field }) {
    const queryHasntValue = key => typeof queryOrParams === 'string' || queryOrParams instanceof String || typeof queryOrParams[key] === 'undefined'
    commit('index', queryHasntValue('index') ? state.index : queryOrParams.index)
    commit('query', queryHasntValue('query') ? queryOrParams : queryOrParams.query)
    commit('from', queryHasntValue('from') ? state.from : queryOrParams.from)
    commit('size', queryHasntValue('size') ? state.size : queryOrParams.size)
    commit('sort', queryHasntValue('sort') ? state.sort : queryOrParams.sort)
    commit('field', queryHasntValue('field') ? state.field : queryOrParams.field)
    return dispatch('refresh', true)
  },
  queryFilter ({ state, getters }, params) {
    return elasticsearch.searchFilter(
      state.index,
      getters.getFilter({ name: params.name }),
      state.query,
      getters.instantiatedFilters,
      state.globalSearch,
      params.options,
      getters.getFields()
    ).then(raw => new EsDocList(raw))
  },
  setFilterValue ({ commit, dispatch }, filter) {
    commit('setFilterValue', filter)
    return dispatch('query')
  },
  addFilterValue ({ commit, dispatch }, filter) {
    commit('addFilterValue', filter)
    return dispatch('query')
  },
  removeFilterValue ({ commit, dispatch }, filter) {
    commit('removeFilterValue', filter)
    return dispatch('query')
  },
  resetFilterValues ({ commit, dispatch }, name) {
    commit('resetFilterValues', name)
    return dispatch('query')
  },
  toggleFilter ({ commit, dispatch }, name) {
    commit('toggleFilter', name)
    return dispatch('query')
  },
  previousPage ({ state, commit, dispatch }, name) {
    commit('from', state.from - state.size)
    return dispatch('query')
  },
  nextPage ({ state, commit, dispatch }, name) {
    commit('from', state.from + state.size)
    return dispatch('query')
  },
  async updateFromRouteQuery ({ state, commit, getters }, query) {
    commit('reset', ['index', 'globalSearch', 'starredDocuments', 'showFilters', 'layout', 'field', 'isDownloadAllowed'])
    // Add the query to the state with a mutation to not triggering a search
    if (query.q) commit('query', query.q)
    if (query.index) commit('index', query.index)
    if (query.from) commit('from', query.from)
    if (query.size) commit('size', query.size)
    if (query.sort) commit('sort', query.sort)
    if (query.field) commit('field', query.field)
    // Iterate over the list of filter
    each(getters.instantiatedFilters, filter => {
      // The filter key are formatted in the URL as follow.
      // See `query-string` for more info about query string format.
      each([`f[${filter.name}]`, `f[-${filter.name}]`], (key, index) => {
        // Add the data if the value exist
        if (key in query) {
          // Because the values are grouped for each query parameter and because
          // the `addFilterValue` also accept an array of value, we can directly
          // use the query values.
          commit('addFilterValue', filter.itemParam({ key: query[key] }))
          // Invert the filter if we are using the second key (for reverse filter)
          if (index) commit('excludeFilter', filter.name)
        }
      })
    })
  },
  deleteQueryTerm ({ state, commit, dispatch }, term) {
    function deleteQueryTermFromSimpleQuery (query) {
      if (get(query, 'left.term', '') === term) query = omit(query, 'left')
      if (get(query, 'right.term', '') === term) query = omit(query, 'right')
      if (has(query, 'left.left')) query.left = deleteQueryTermFromSimpleQuery(get(query, 'left', null))
      if (has(query, 'right.left')) query.right = deleteQueryTermFromSimpleQuery(get(query, 'right', null))
      if (has(query, 'right.right') && !has(query, 'right.left') && get(query, 'operator', '').includes('NOT')) query.operator = '<implicit>'
      if (has(query, 'start') && !has(query, 'left')) query = omit(query, 'start')
      if (has(query, 'operator') && (!has(query, 'left') || !has(query, 'right'))) query = omit(query, 'operator')
      if (has(query, 'parenthesized') && (!has(query, 'left') || !has(query, 'right'))) query = omit(query, 'parenthesized')
      return query
    }
    const query = deleteQueryTermFromSimpleQuery(lucene.parse(state.query))
    commit('query', lucene.toString(query))
    return dispatch('query')
  },
  async starDocuments ({ state, commit }, documents) {
    const documentIds = map(documents, 'id')
    await api.starDocuments(state.index, documentIds)
    commit('pushFromStarredDocuments', documentIds)
  },
  async unstarDocuments ({ state, commit }, documents) {
    const documentIds = map(documents, 'id')
    await api.unstarDocuments(state.index, documentIds)
    commit('removeFromStarredDocuments', documentIds)
  },
  toggleStarDocument ({ state, commit, dispatch }, documentId) {
    const documents = [{ id: documentId }]
    if (state.starredDocuments.indexOf(documentId) >= 0) {
      return dispatch('unstarDocuments', documents)
    } else {
      return dispatch('starDocuments', documents)
    }
  },
  async getStarredDocuments ({ state, commit }) {
    const starredDocuments = await api.getStarredDocuments(state.index)
    commit('starredDocuments', starredDocuments)
  },
  async getIsDownloadAllowed ({ state, commit }) {
    try {
      await api.isDownloadAllowed(state.index)
      commit('isDownloadAllowed', true)
    } catch (e) {
      commit('isDownloadAllowed', false)
    }
  }
}

export default {
  namespaced: true,
  state,
  getters,
  mutations,
  actions
}
