import esClient from '@/api/esClient'
import Response from '@/api/Response'
import { getDocumentTypeLabel, getExtractionLevelTranslationKey } from '@/utils/utils'
import settings from '@/utils/settings'
import { FacetText, FacetYesNo, FacetDate, FacetDateRange, FacetPath, FacetNamedEntity, namedEntityCategoryTranslation, starredLabel } from '@/store/facetsStore'
import DatashareClient from '@/api/DatashareClient'
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
import filter from 'lodash/filter'
import find from 'lodash/find'
import get from 'lodash/get'
import has from 'lodash/has'
import includes from 'lodash/includes'
import isInteger from 'lodash/isInteger'
import isString from 'lodash/isString'
import join from 'lodash/join'
import map from 'lodash/map'
import omit from 'lodash/omit'
import orderBy from 'lodash/orderBy'
import range from 'lodash/range'
import random from 'lodash/random'
import reduce from 'lodash/reduce'
import toLower from 'lodash/toLower'
import uniq from 'lodash/uniq'
import values from 'lodash/values'

export const datashare = new DatashareClient()

export function initialState () {
  return {
    query: '',
    from: 0,
    size: 25,
    globalSearch: true,
    facets: [
      new FacetYesNo('starred', '_id', false, item => get(starredLabel, item.key, '')),
      new FacetText('tags', 'tags', true),
      new FacetText('content-type', 'contentType', true, item => getDocumentTypeLabel(item.key), query => map(types, (item, key) => { if (toLower(item.label).includes(query)) return key })),
      new FacetText('language', 'language', false, item => `facet.lang.${item.key}`),
      new FacetNamedEntity('named-entity-person', 'byMentions', true, namedEntityCategoryTranslation['named-entity-person']),
      new FacetNamedEntity('named-entity-organization', 'byMentions', true, namedEntityCategoryTranslation['named-entity-organization']),
      new FacetNamedEntity('named-entity-location', 'byMentions', true, namedEntityCategoryTranslation['named-entity-location']),
      new FacetPath('path', 'byDirname', false),
      new FacetDate('indexing-date', 'extractionDate', false, item => item.key_as_string),
      new FacetText('extraction-level', 'extractionLevel', false, item => getExtractionLevelTranslationKey(item.key)),
      new FacetDateRange('creation-date', 'metadata.tika_metadata_creation_date', false, item => isInteger(item.key) ? moment(item.key).locale(localStorage.getItem('locale')).format('L') : item.key)
    ],
    sort: settings.defaultSearchSort,
    field: settings.defaultSearchField,
    response: Response.none(),
    isReady: true,
    error: null,
    index: '',
    showFilters: true,
    starredDocuments: [],
    layout: 'list'
  }
}

export const state = initialState

export const getters = {
  getFacet (state) {
    return predicate => find(state.facets, predicate)
  },
  getFields (state) {
    return () => {
      return find(settings.searchFields, { key: state.field }).fields
    }
  },
  hasFacetValue (state) {
    return item => !!find(state.facets, facet => {
      return facet.name === item.name && facet.values.indexOf(item.value) > -1
    })
  },
  hasFacetValues (state) {
    return name => !!find(state.facets, facet => {
      return facet.name === name && facet.values.length > 0
    })
  },
  isFacetReversed (state) {
    return name => {
      return !!find(state.facets, facet => {
        return facet.name === name && facet.reverse
      })
    }
  },
  activeFacets (state) {
    return filter(state.facets, f => f.hasValues())
  },
  findFacet (state) {
    return name => find(state.facets, { name })
  },
  toRouteQuery (state) {
    return {
      q: state.query,
      from: state.from,
      size: state.size,
      sort: state.sort,
      index: state.index,
      field: state.field,
      ...reduce(state.facets, (memo, facetValue) => {
        // We need to look for the facet's definition in order to us its `id`
        // as key for the URL params. This was we track configured facet instead
        // of arbitrary values provided by the user. This allow to retrieve special
        // behaviors depending on the facet definition.
        const facet = find(state.facets, { name: facetValue.name })
        // We don't add facetValue that match with any existing facets
        // defined in the `aggregation` store.
        if (facet && facetValue.values.length > 0) {
          const key = facetValue.reverse ? `f[-${facet.name}]` : `f[${facet.name}]`
          memo[key] = facetValue.values
        }
        return memo
      }, {})
    }
  },
  toRouteQueryWithStamp (state, getters) {
    return {
      ...getters.toRouteQuery,
      // A random string of 6 chars
      stamp: String.fromCharCode.apply(null, range(6).map(() => random(97, 122)))
    }
  },
  retrieveQueryTerms (state) {
    let terms = []
    function getTerm (object, path, start, operator) {
      const term = get(object, join([path, 'term'], '.'), '')
      const field = get(object, join([path, 'field'], '.'), '')
      const prefix = get(object, join([path, 'prefix'], '.'), '')
      const negation = ['-', '!'].includes(prefix) || start === 'NOT' || endsWith(operator, 'NOT')
      if (term !== '*' && term !== '' && !includes(map(terms, 'label'), term)) {
        terms = concat(terms, { field: field === '<implicit>' ? '' : field, label: term.replace('\\', ''), negation })
      }
    }
    function retTerms (query, operator) {
      getTerm(query, 'left', get(query, 'start', null), operator)
      if (get(query, 'right.left', null) === null) {
        getTerm(query, 'right', null, get(query, 'operator', null))
      } else {
        retTerms(get(query, 'right'), get(query, 'operator', null))
      }
    }
    try {
      retTerms(lucene.parse(state.query), null)
      return terms
    } catch (_) {
      return []
    }
  },
  retrieveContentQueryTerms (state, getters) {
    const fields = ['', 'content']
    return filter(getters.retrieveQueryTerms, item => fields.includes(item.field))
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
  retrieveContentQueryTermsInContent (state, getters) {
    return (text, field) => getters.retrieveContentQueryTerms.map(term => {
      term[field] = (text.match(new RegExp(escapeRegExp(term.label), 'gi')) || []).length
      return term
    })
  },
  sortBy (state) {
    return find(settings.searchSortFields, { name: state.sort })
  }
}

export const mutations = {
  reset (state, excludedKeys = ['index', 'showFilters', 'layout']) {
    const s = initialState()
    Object.keys(s).forEach(key => {
      if (excludedKeys.indexOf(key) === -1) {
        state[key] = s[key]
      }
    })
    const existingFacet = find(state.facets, { name: 'starred' })
    if (existingFacet) {
      existingFacet.starredDocuments = state.starredDocuments
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
  starredDocuments (state, starredDocuments) {
    state.starredDocuments = starredDocuments
  },
  buildResponse (state, raw) {
    state.isReady = true
    state.response = new Response(raw)
  },
  appendToResponse (state, raw) {
    state.response.append(raw)
  },
  setFacets (state, facets) {
    state.facets = facets
  },
  addFacet (state, facet) {
    if (find(state.facets, { name: facet.name })) {
      throw new Error('Facet already exists')
    }
    return state.facets.push(facet)
  },
  addFacetValue (state, facet) {
    // We cast the new facet values to allow several new values at the same time
    const values = castArray(facet.value)
    // Look for existing facet for this name
    const existingFacet = find(state.facets, { name: facet.name })
    if (existingFacet) {
      existingFacet.values = uniq(existingFacet.values.concat(values))
    } else {
      throw new Error(`cannot find facet named ${facet.name}`)
    }
  },
  setFacetValue (state, facet) {
    // Look for existing facet for this name
    const existingFacet = find(state.facets, { name: facet.name })
    if (existingFacet) {
      existingFacet.values = castArray(facet.value)
    } else {
      throw new Error(`cannot find facet named ${facet.name}`)
    }
  },
  addFacetValues (state, { facet, values }) {
    const existingFacet = find(state.facets, { name: facet.name })
    if (existingFacet) {
      existingFacet.values = values
    } else {
      throw new Error(`cannot find facet named ${facet.name}`)
    }
  },
  removeFacetValue (state, facet) {
    const existingFacet = find(state.facets, { name: facet.name })
    if (existingFacet) {
      // Filter the values for this name to remove the given value
      existingFacet.values = filter(existingFacet.values, value => value !== facet.value)
    }
  },
  excludeFacet (state, name) {
    const existingFacet = find(state.facets, { name })
    if (existingFacet) {
      existingFacet.reverse = true
    }
  },
  toggleFacet (state, name) {
    const existingFacet = find(state.facets, { name })
    if (existingFacet) {
      existingFacet.reverse = !existingFacet.reverse
    }
  },
  resetFacetValues (state, name) {
    const existingFacet = find(state.facets, { name })
    if (existingFacet) {
      existingFacet.values = []
    }
  },
  toggleFilters (state) {
    state.showFilters = !state.showFilters
  },
  pushFromStarredDocuments (state, documentIds) {
    state.starredDocuments = uniq(concat(state.starredDocuments, documentIds))
  },
  removeFromStarredDocuments (state, documentIds) {
    state.starredDocuments = difference(state.starredDocuments, documentIds)
  },
  setStarredDocuments (state) {
    const existingFacet = find(state.facets, { name: 'starred' })
    if (existingFacet) {
      existingFacet.starredDocuments = state.starredDocuments
    }
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
      const raw = await esClient.searchDocs(state.index, state.query, state.facets, state.from, state.size, state.sort, getters.getFields())
      commit('buildResponse', raw)
      return raw
    } catch (error) {
      commit('isReady', true)
      commit('error', error)
      throw error
    }
  },
  async query ({ state, commit, getters, dispatch }, queryOrParams = { index: state.index, query: state.query, from: state.from, size: state.size, sort: state.sort, field: state.field }) {
    const queryHasntValue = key => typeof queryOrParams === 'string' || queryOrParams instanceof String || typeof queryOrParams[key] === 'undefined'
    commit('index', queryHasntValue('index') ? state.index : queryOrParams.index)
    commit('query', queryHasntValue('query') ? queryOrParams : queryOrParams.query)
    commit('from', queryHasntValue('from') ? state.from : queryOrParams.from)
    commit('size', queryHasntValue('size') ? state.size : queryOrParams.size)
    commit('sort', queryHasntValue('sort') ? state.sort : queryOrParams.sort)
    commit('field', queryHasntValue('field') ? state.field : queryOrParams.field)
    return dispatch('refresh', true)
  },
  queryFacet ({ state, getters }, params) {
    return esClient.searchFacet(
      state.index,
      getters.getFacet({ name: params.name }),
      state.query,
      state.facets,
      state.globalSearch,
      params.options,
      getters.getFields()
    ).then(raw => new Response(raw))
  },
  queryFacetGlobally ({ state, getters }, params) {
    return esClient.searchFacet(
      state.index,
      getters.getFacet({ name: params.name }),
      '*',
      state.facets,
      true,
      params.options,
      getters.getFields()
    ).then(raw => new Response(raw))
  },
  addFacetValue ({ commit, dispatch }, facet) {
    commit('addFacetValue', facet)
    return dispatch('query')
  },
  removeFacetValue ({ commit, dispatch }, facet) {
    commit('removeFacetValue', facet)
    return dispatch('query')
  },
  resetFacetValues ({ commit, dispatch }, name) {
    commit('resetFacetValues', name)
    return dispatch('query')
  },
  toggleFacet ({ commit, dispatch }, name) {
    commit('toggleFacet', name)
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
  updateFromRouteQuery ({ state, commit }, query) {
    commit('reset', ['index', 'globalSearch', 'starredDocuments', 'showFilters', 'layout', 'field'])
    // Add the query to the state with a mutation to not triggering a search
    if (query.q) commit('query', query.q)
    if (query.index) commit('index', query.index)
    if (query.from) commit('from', query.from)
    if (query.size) commit('size', query.size)
    if (query.sort) commit('sort', query.sort)
    if (query.field) commit('field', query.field)
    // Iterate over the list of facet
    each(state.facets, facet => {
      // The facet key are formatted in the URL as follow.
      // See `query-string` for more info about query string format.
      each([`f[${facet.name}]`, `f[-${facet.name}]`], (key, index) => {
        // Add the data if the value exist
        if (query.hasOwnProperty(key)) {
          // Because the values are grouped for each query parameter and because
          // the `addFacetValue` also accept an array of value, we can directly
          // use the query values.
          commit('addFacetValue', facet.itemParam({ key: query[key] }))
          // Invert the facet if we are using the second key (for reverse facet)
          if (index) commit('excludeFacet', facet.name)
        }
      })
    })
  },
  deleteQueryTerm ({ state, commit, dispatch }, term) {
    function deleteQueryTermFromSimpleQuery (query) {
      if (get(query, 'left.term', '') === term) query = omit(query, 'left')
      if (get(query, 'right.term', '') === term) query = omit(query, 'right')
      if (has(query, 'right.left')) query.right = deleteQueryTermFromSimpleQuery(get(query, 'right', null))
      if (has(query, 'right.right') && !has(query, 'right.left') && get(query, 'operator', '').includes('NOT')) query.operator = '<implicit>'
      if (has(query, 'start') && !has(query, 'left')) query = omit(query, 'start')
      if (has(query, 'operator') && (!has(query, 'left') || !has(query, 'right'))) query = omit(query, 'operator')
      return query
    }
    const query = deleteQueryTermFromSimpleQuery(lucene.parse(state.query))
    commit('query', lucene.toString(query))
    return dispatch('query')
  },
  async starDocuments ({ state, commit }, documents) {
    const documentIds = map(documents, 'id')
    await datashare.starDocuments(state.index, documentIds)
    commit('pushFromStarredDocuments', documentIds)
    commit('setStarredDocuments')
  },
  async unstarDocuments ({ state, commit }, documents) {
    const documentIds = map(documents, 'id')
    await datashare.unstarDocuments(state.index, documentIds)
    commit('removeFromStarredDocuments', documentIds)
    commit('setStarredDocuments')
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
    const starredDocuments = await datashare.getStarredDocuments(state.index)
    commit('starredDocuments', starredDocuments)
    commit('setStarredDocuments')
  }
}

export default {
  namespaced: true,
  state,
  getters,
  actions,
  mutations
}
