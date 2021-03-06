import toLower from 'lodash/toLower'
import { createLocalVue, shallowMount } from '@vue/test-utils'

import { Core } from '@/core'
import { getShortkeyOS } from '@/utils/utils'
import SearchDocumentNavbar from '@/components/SearchDocumentNavbar'

jest.mock('@/utils/utils')

const { localVue, store } = Core.init(createLocalVue()).useAll()

describe('SearchDocumentNavbar.vue', () => {
  const index = toLower('SearchDocumentNavbar')
  let wrapper

  beforeAll(() => store.commit('search/index', index))

  beforeEach(() => {
    wrapper = shallowMount(SearchDocumentNavbar, { localVue, store, mocks: { $t: msg => msg } })
  })

  afterAll(() => jest.unmock('@/utils/utils'))

  it('should display a "Back to the search results" link', () => {
    expect(wrapper.find('.search-document-navbar__back').exists()).toBeTruthy()
  })

  it('should return the tooltip for mac', () => {
    getShortkeyOS.mockReturnValueOnce('mac')

    expect(wrapper.vm.previousTooltip).toBe('search.nav.previous.tooltipMac')
  })

  it('should return the tooltip for NOT mac', () => {
    getShortkeyOS.mockReturnValueOnce('default')

    expect(wrapper.vm.previousTooltip).toBe('search.nav.previous.tooltipOthers')
  })
})
