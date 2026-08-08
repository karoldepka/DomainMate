import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const paymentDialog = readFileSync(join(rootDir, 'app', 'components', 'PaymentDialog.vue'), 'utf8')
const indexPage = readFileSync(join(rootDir, 'app', 'pages', 'index.vue'), 'utf8')
const payments = readFileSync(join(rootDir, 'server', 'utils', 'payments.js'), 'utf8')

test('Stripe Checkout returns to the app with its session ID for verification', () => {
  assert.match(payments, /success_url:\s*paymentReturnUrl\(origin, returnPath, 'success', true\)/)
  assert.match(payments, /searchParams\.set\('session_id', '\{CHECKOUT_SESSION_ID\}'\)/)
})

test('Checkout uses dynamic payment methods and preserves the current workspace', () => {
  assert.doesNotMatch(payments, /payment_method_types/)
  assert.match(payments, /integration_identifier:/)
  assert.match(paymentDialog, /returnPath:\s*`\$\{window\.location\.pathname\}/)
})

test('a verified paid Stripe return opens the localized thank-you screen', () => {
  assert.match(indexPage, /<PaymentDialog ref="paymentDialog" \/>/)
  assert.doesNotMatch(indexPage, /<PaymentDialog v-if=/)
  assert.match(paymentDialog, /fetch\(`\/api\/payments\/verify\?session_id=/)
  assert.match(paymentDialog, /response\.ok\s*&&\s*data\.paid\s*&&\s*data\.tierId/)
  assert.match(paymentDialog, /successOpen\.value\s*=\s*true/)
  assert.match(paymentDialog, /t\('payment\.success\.title'\)/)
  assert.match(paymentDialog, /t\('payment\.success\.message'/)
  assert.match(paymentDialog, /t\('payment\.success\.continue'\)/)
})
