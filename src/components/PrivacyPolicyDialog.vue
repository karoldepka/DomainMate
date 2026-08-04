<script setup>
import { useTemplateRef } from 'vue'
import { X } from 'lucide-vue-next'
import { t } from '../i18n'

const dialog = useTemplateRef('privacyDialog')

function open() { dialog.value?.showModal() }

defineExpose({ open })
</script>

<template>
  <dialog ref="privacyDialog" class="payment-dialog privacy-dialog" closedby="any">
    <div class="dialog-header">
      <div><p class="dialog-eyebrow">{{ t('privacy.eyebrow') }}</p><h2>{{ t('privacy.title') }}</h2></div>
      <button type="button" class="icon-button" :aria-label="t('privacy.close')" @click="dialog?.close()"><X :size="19" /></button>
    </div>
    <div class="privacy-body">
      <p class="privacy-meta">Last updated August 2026 · <em>{{ t('privacy.englishOnly') }}</em></p>

      <h3>What we collect</h3>
      <ul>
        <li><strong>Anonymous usage data.</strong> Aggregated, anonymized statistics about how the app is used — which features are opened, how searches run, and general interaction patterns (this may include heatmap-style click and scroll data) — to understand what's working and improve the product. This isn't tied to your name, email, or any other identifying information.</li>
        <li><strong>The queries you enter.</strong> The name parts, keywords, and candidate domains you type are sent to our backend so it can run availability checks, Google result counts, AI word suggestions, and registrar price comparisons. This happens server-side because it requires calling external APIs your browser can't call directly (to keep API keys private and avoid CORS restrictions). We don't keep a permanent log of what you searched beyond short-lived caching needed to keep the app responsive.</li>
        <li><strong>Ratings and feedback</strong>, only if you choose to sync them: a random ID stored in your browser (not your name or email), the domains you rated, and any feedback message you submit.</li>
        <li><strong>Crash reports</strong>, only if enabled: an error message, stack trace, page URL, and browser identifier — never the contents of what you typed.</li>
      </ul>

      <h3>What we don't do</h3>
      <p>We do not sell your data, and we do not publish it. Where we use third-party infrastructure (such as an analytics or session-recording provider) to help us understand usage, we only share anonymized, aggregated interaction data with them, under their own confidentiality commitments — never your name, email, or the literal contents of your searches.</p>

      <h3>How long we keep it</h3>
      <p>We retain usage and interaction data for up to 12 months from collection, after which it's deleted or irreversibly aggregated so it can no longer be tied to an individual session. Feedback messages and synced ratings are kept until you ask us to delete them, or for up to 12 months of inactivity, whichever comes first.</p>

      <h3>Questions or deletion requests</h3>
      <p>Contact <a href="mailto:privacy@domainmate.app">privacy@domainmate.app</a> and we'll answer questions or delete your data on request.</p>
    </div>
  </dialog>
</template>
