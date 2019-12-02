import { createLocalVue, mount, shallowMount } from '@vue/test-utils'
import { createServer } from 'http-server'
import Murmur from '@icij/murmur'

import { App } from '@/main'
import { datashare } from '@/store/modules/document'
import DatashareClient from '@/api/DatashareClient'
import DocumentView from '@/pages/DocumentView'
import esConnectionHelper from 'tests/unit/specs/utils/esConnectionHelper'
import { IndexedDocument, letData } from 'tests/unit/es_utils'
import { jsonOk } from 'tests/unit/tests_utils'

const { localVue, i18n, store, router } = App.init(createLocalVue()).useAll()

describe('DocumentView.vue', () => {
  esConnectionHelper()
  const es = esConnectionHelper.es
  const id = 'document'
  const index = process.env.VUE_APP_ES_INDEX
  let httpServer

  beforeAll(() => {
    httpServer = createServer({ root: 'tests/unit/resources' })
    httpServer.listen(9876)
  })

  afterEach(() => {
    store.commit('document/reset')
    Murmur.config.merge({ dataDir: null, mountedDataDir: null })
  })

  afterAll(() => httpServer.close())

  it('should display an error message if document is not found', async () => {
    const anotherId = 'notfound'
    const wrapper = mount(DocumentView, { localVue, i18n, store, router, propsData: { id: anotherId, index } })

    await wrapper.vm.getDoc()

    expect(wrapper.find('span').text()).toEqual('Document not found')
  })

  it('should call to the API to retrieve tags', async () => {
    jest.spyOn(datashare, 'fetch')
    datashare.fetch.mockReturnValue(jsonOk([{ label: 'tag', user: { id: 'local' }, creationDate: '2019-09-29T21:57:57.565+0000' }]))
    await letData(es).have(new IndexedDocument(id)).commit()
    const wrapper = shallowMount(DocumentView, { localVue, store, router, propsData: { id, index }, mocks: { $t: msg => msg } })

    await wrapper.vm.getDoc()

    expect(datashare.fetch).toBeCalledTimes(1)
    expect(datashare.fetch).toBeCalledWith(DatashareClient.getFullUrl(`/api/${index}/documents/tags/${id}`), {})
  })

  it('should display a document', async () => {
    Murmur.config.merge({ dataDir: null, mountedDataDir: null })
    const wrapper = mount(DocumentView, { localVue, i18n, store, router, propsData: { id, index } })

    await letData(es).have(new IndexedDocument(id)
      .withContent('this is foo document'))
      .commit()
    await wrapper.vm.getDoc()

    expect(wrapper.contains('.document__header')).toBeTruthy()
  })

  it('should display tags', async () => {
    Murmur.config.merge({ dataDir: null, mountedDataDir: null })
    const wrapper = shallowMount(DocumentView, { localVue, i18n, store, router, propsData: { id, index } })

    await letData(es).have(new IndexedDocument(id)
      .withContent('this is foo document'))
      .commit()
    await wrapper.vm.getDoc()

    expect(wrapper.contains('document-tags-form-stub')).toBeTruthy()
  })

  it('should display the named entities tab', async () => {
    Murmur.config.merge({ dataDir: null, mountedDataDir: null, manageDocuments: true })
    const wrapper = mount(DocumentView, { localVue, i18n, store, router, propsData: { id, index } })

    await letData(es).have(new IndexedDocument(id)
      .withContent('this is foo document'))
      .commit()
    await wrapper.vm.getDoc()

    expect(wrapper.findAll('.document .document__header__nav__item')).toHaveLength(4)
    expect(wrapper.findAll('.document .document__header__nav__item').at(2).text()).toContain('Named Entities')
  })

  it('should NOT display the named entities tab', async () => {
    Murmur.config.merge({ manageDocuments: false })
    const wrapper = mount(DocumentView, { localVue, i18n, store, router, propsData: { id, index } })

    await letData(es).have(new IndexedDocument(id)
      .withContent('this is foo document'))
      .commit()
    await wrapper.vm.getDoc()

    expect(wrapper.findAll('.document .document__header__nav__item')).toHaveLength(3)
    expect(wrapper.findAll('.document .document__header__nav__item').at(2).text()).not.toContain('Named Entities')
  })

  describe('navigate through tabs as loop', () => {
    it('should set the previous tab as active', async () => {
      const wrapper = shallowMount(DocumentView, { localVue, i18n, store, router, propsData: { id, index } })
      await letData(es).have(new IndexedDocument(id)).commit()
      await wrapper.vm.getDoc()

      wrapper.vm.activeTab = 'details'
      wrapper.vm.goToPreviousTab()

      expect(wrapper.vm.activeTab).toBe('extracted-text')
    })

    it('should set the next tab as active', async () => {
      const wrapper = shallowMount(DocumentView, { localVue, i18n, store, router, propsData: { id, index } })
      await letData(es).have(new IndexedDocument(id)).commit()
      await wrapper.vm.getDoc()

      wrapper.vm.goToNextTab()

      expect(wrapper.vm.activeTab).toBe('details')
    })

    it('should set the last tab as active', async () => {
      const wrapper = shallowMount(DocumentView, { localVue, i18n, store, router, propsData: { id, index } })
      await letData(es).have(new IndexedDocument(id)).commit()
      await wrapper.vm.getDoc()

      wrapper.vm.goToPreviousTab()

      expect(wrapper.vm.activeTab).toBe('preview')
    })

    it('should set the first tab as active', async () => {
      const wrapper = shallowMount(DocumentView, { localVue, i18n, store, router, propsData: { id, index } })
      await letData(es).have(new IndexedDocument(id)).commit()
      await wrapper.vm.getDoc()

      wrapper.vm.activeTab = 'preview'
      wrapper.vm.goToNextTab()

      expect(wrapper.vm.activeTab).toBe('extracted-text')
    })
  })
})
