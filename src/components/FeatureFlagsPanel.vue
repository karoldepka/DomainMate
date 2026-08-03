<script setup>
import { useTemplateRef, watch } from 'vue'
import { FlaskConical, X } from 'lucide-vue-next'
import { flags, flagList } from '../featureFlags'

const props = defineProps({ modelValue: { type: Boolean, required: true } })
const emit = defineEmits(['update:modelValue'])
const dialog = useTemplateRef('flagsDialog')

watch(() => props.modelValue, (open) => {
  if (open) dialog.value?.showModal()
  else dialog.value?.close()
})
</script>

<template>
  <dialog ref="flagsDialog" class="flags-dialog" closedby="any" @close="emit('update:modelValue', false)">
    <div class="dialog-header">
      <div><p class="dialog-eyebrow"><FlaskConical :size="13" /> Debug</p><h2>Feature flags</h2></div>
      <button type="button" class="icon-button" aria-label="Close feature flags" @click="dialog?.close()"><X :size="19" /></button>
    </div>
    <p class="flags-hint">Backend- and AI-dependent features are off by default. Toggles persist on this device only.</p>
    <ul class="flags-list">
      <li v-for="flag in flagList" :key="flag.key">
        <label>
          <input v-model="flags[flag.key]" type="checkbox" />
          <span>{{ flag.label }}</span>
        </label>
        <small>{{ flag.description }}</small>
      </li>
    </ul>
  </dialog>
</template>
