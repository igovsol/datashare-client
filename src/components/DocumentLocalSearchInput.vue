<script>
import shortkeys from '@/mixins/shortkeys'
import utils from '@/mixins/utils'

export default {
  name: 'DocumentLocalSearchInput',
  mixins: [shortkeys, utils],
  model: {
    prop: 'searchTerm',
    event: 'input'
  },
  props: {
    searchTerm: Object,
    searchIndex: {
      type: Number,
      default: 0
    },
    searchOccurrences: {
      type: Number,
      default: 0
    },
    searchWorkerInProgress: Boolean
  },
  data () {
    return {
      isActive: false
    }
  },
  watch: {
    searchTerm () {
      this.activateSearchBar()
    }
  },
  methods: {
    start () {
      this.$emit('start', this.searchTerm)
    },
    previous () {
      this.$emit('previous', this.searchTerm)
    },
    next () {
      this.$emit('next', this.searchTerm)
    },
    activateSearchBar () {
      this.$emit('update:activated', true)
      this.$set(this, 'isActive', true)
      this.$nextTick(() => {
        if (this.$refs.search) {
          this.$refs.search.focus()
        }
      })
    },
    deactivateSearchBar () {
      this.$emit('update:activated', false)
      this.$set(this, 'isActive', false)
      this.$emit('input', '')
    },
    shortkeyAction ({ srcKey }) {
      if (this.shortkeysActions[srcKey]) {
        return this.shortkeysActions[srcKey]()
      }
    }
  },
  computed: {
    shortkeysActions () {
      return {
        activateSearchBar: this.activateSearchBar,
        deactivateSearchBar: this.deactivateSearchBar,
        findPreviousOccurrence: this.previous,
        findPreviousOccurrenceAlt: this.previous,
        findNextOccurrence: this.next,
        findNextOccurrenceAlt: this.next
      }
    }
  }
}
</script>

<template>
  <div class="document-local-search-input form-inline px-3" :class="{ 'document-local-search-input--active': isActive, 'document-local-search-input--pristine': searchTerm.label.length > 0 }">
    <div class="form-group py-2 mr-2">
      <label class="sr-only">{{ $t('document.search') }}</label>
      <div class="input-group">
        <input type="search" :value="searchTerm.label" @input="$emit('input', { label: $event.target.value })" :placeholder="$t('document.find')" ref="search" class="form-control document-local-search-input__term" v-shortkey="getKeys('findInDocument')" @shortkey="getAction('findInDocument')" />
        <div class="document-local-search-input__count input-group-append" v-if="searchTerm.label.length > 0">
          <span v-if="searchWorkerInProgress" class="input-group-text">
            <fa icon="circle-notch" spin />
          </span>
          <span v-else class="input-group-text">
            <span>{{ searchIndex }} {{ $t('document.of') }} {{ searchOccurrences }}</span>
          </span>
        </div>
      </div>
    </div>
    <div class="form-group">
      <button class="document-local-search-input__previous btn btn-sm p-2" @click="previous" :disabled="searchOccurrences === 0 || searchTerm.label.length === 0">
        <fa icon="angle-up" />
      </button>
      <button class="document-local-search-input__next btn btn-sm p-2" @click="next" :disabled="searchOccurrences === 0 || searchTerm.label.length === 0">
        <fa icon="angle-down" />
      </button>
    </div>
  </div>
</template>

<style lang="scss">
  .document-local-search-input {
    justify-content: flex-end;
    white-space: nowrap;

    &--pristine.form-inline .input-group &__term {
      border-radius: 1.5em 0 0 1.5em;
    }

    &.form-inline &__term {
      border-radius: 1.5em;
    }

    &__count .input-group-text {
      border-radius: 0 1.5em 1.5em 0;
    }

    &.form-inline {
      white-space: nowrap;
      flex-wrap: nowrap;

      .input-group {
        width: 300px;

        .input-group-text {
          border-left: 0;
          background: $input-bg;
        }
      }
    }
  }
</style>
