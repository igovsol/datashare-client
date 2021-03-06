import axios from 'axios'
import cloneDeep from 'lodash/cloneDeep'
import toLower from 'lodash/toLower'

import Api from '@/api'
import store from '@/store'

jest.mock('axios', () => {
  return {
    request: jest.fn().mockResolvedValue({ data: {} })
  }
})

describe('IndexingStore', () => {
  const index = toLower('IndexingStore')

  beforeAll(() => store.commit('search/index', index))

  afterEach(() => {
    store.commit('indexing/reset')
    axios.request.mockClear()
  })

  it('should define a store module', () => {
    expect(store.state.indexing).not.toBeUndefined()
  })

  it('should reset the store state', async () => {
    const initialState = cloneDeep(store.state.indexing)
    await store.commit('indexing/reset')

    expect(store.state.indexing).toEqual(initialState)
  })

  it('should execute a default extract action', async () => {
    await store.dispatch('indexing/submitExtract')

    expect(axios.request).toBeCalledTimes(1)
    expect(axios.request).toBeCalledWith(expect.objectContaining({
      url: Api.getFullUrl('/api/task/batchUpdate/index/file'),
      method: 'POST',
      data: { options: { ocr: false, filter: true } }
    }))
  })

  it('should execute a default find named entities action', async () => {
    await store.dispatch('indexing/submitFindNamedEntities')

    expect(axios.request).toBeCalledTimes(1)
    expect(axios.request).toBeCalledWith(expect.objectContaining({
      url: Api.getFullUrl('/api/task/findNames/CORENLP'),
      method: 'POST',
      data: { options: { syncModels: true } }
    }))
  })

  it('should stop pending tasks', async () => {
    store.commit('indexing/updateTasks', [{ name: 'foo.bar@123', progress: 0.5, state: 'RUNNING' }])
    expect(store.state.indexing.tasks).toHaveLength(1)

    await store.dispatch('indexing/stopPendingTasks')

    expect(store.state.indexing.tasks).toHaveLength(0)
    expect(axios.request).toBeCalledTimes(1)
    expect(axios.request).toBeCalledWith(expect.objectContaining({
      url: Api.getFullUrl('/api/task/stopAll'),
      method: 'PUT'
    }))
  })

  it('should stop the task named 456', async () => {
    store.commit('indexing/updateTasks', [{ name: 'foo.bar@123', progress: 0.5, state: 'RUNNING' },
      { name: 'foo.bar@456', progress: 0.7, state: 'RUNNING' }])
    expect(store.state.indexing.tasks).toHaveLength(2)

    await store.dispatch('indexing/stopTask', 'foo.bar@123')

    expect(store.state.indexing.tasks).toHaveLength(1)
    expect(axios.request).toBeCalledTimes(1)
    expect(axios.request).toBeCalledWith(expect.objectContaining({
      url: Api.getFullUrl(`/api/task/stop/${encodeURIComponent('foo.bar@123')}`),
      method: 'PUT'
    }))
  })

  it('should delete done tasks', async () => {
    store.commit('indexing/updateTasks', [{ name: 'foo.bar@123', progress: 0.5, state: 'DONE' }])
    expect(store.state.indexing.tasks).toHaveLength(1)

    await store.dispatch('indexing/deleteDoneTasks')

    expect(store.state.indexing.tasks).toHaveLength(0)
    expect(axios.request).toBeCalledTimes(1)
    expect(axios.request).toBeCalledWith(expect.objectContaining({
      url: Api.getFullUrl('/api/task/clean'),
      method: 'POST'
    }))
  })

  it('should stop polling jobs', async () => {
    await store.dispatch('indexing/stopPollTasks')

    expect(store.state.indexing.pollHandle).toBeNull()
  })

  it('should reset the extracting form', async () => {
    store.commit('indexing/updateField', { path: 'form.ocr', value: true })
    expect(store.state.indexing.form.ocr).toBeTruthy()

    await store.dispatch('indexing/resetExtractForm')
    expect(store.state.indexing.form.ocr).toBeFalsy()
  })

  it('should reset the Find Named Entities form', async () => {
    store.commit('indexing/updateField', { path: 'form.pipeline', value: 'opennlp' })
    store.commit('indexing/updateField', { path: 'form.offline', value: true })
    expect(store.state.indexing.form.pipeline).toBe('opennlp')
    expect(store.state.indexing.form.offline).toBeTruthy()

    await store.dispatch('indexing/resetFindNamedEntitiesForm')

    expect(store.state.indexing.form.pipeline).toBe('corenlp')
    expect(store.state.indexing.form.offline).toBeFalsy()
  })

  it('should delete all the documents in the index', async () => {
    await store.dispatch('indexing/deleteAll')

    expect(axios.request).toBeCalledTimes(1)
    expect(axios.request).toBeCalledWith(expect.objectContaining({
      url: Api.getFullUrl(`/api/project/${index}`),
      method: 'DELETE'
    }))
  })
})
