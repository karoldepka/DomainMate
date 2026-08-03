<script setup>
import { flags, flagList } from '../featureFlags.js'

defineProps({ modelValue: { type: Boolean, required: true } })
defineEmits(['update:modelValue'])
</script>

<template>
  <UModal
    :open="modelValue"
    :ui="{ content: 'flags-dialog-body' }"
    @update:open="(value) => $emit('update:modelValue', value)"
  >
    <template #header>
      <div class="dialog-header w-full">
        <div>
          <p class="dialog-eyebrow"><UIcon name="i-lucide-flask-conical" class="size-3.5" /> Debug</p>
          <h2>Feature flags</h2>
        </div>
        <UButton aria-label="Close feature flags" icon="i-lucide-x" color="neutral" variant="ghost" @click="$emit('update:modelValue', false)" />
      </div>
    </template>
    <template #body>
      <p class="flags-hint">Backend- and AI-dependent features are off by default. Toggles persist on this device only.</p>
      <ul class="flags-list">
        <li v-for="flag in flagList" :key="flag.key">
          <label>
            <UCheckbox v-model="flags[flag.key]" />
            <span>{{ flag.label }}</span>
          </label>
          <small>{{ flag.description }}</small>
        </li>
      </ul>
    </template>
  </UModal>
</template>
