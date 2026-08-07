import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const paymentDialog = readFileSync(join(rootDir, 'app', 'components', 'PaymentDialog.vue'), 'utf8')
const payments = readFileSync(join(rootDir, 'server', 'utils', 'payments.js'), 'utf8')

test('Stripe Checkout returns to the app with its session ID for verification', () => {
  assert.match(payments, /success_url:\s*`\$\{origin\}\/\?payment=success&session_id=\{CHECKOUT_SESSION_ID\}`/)
})

test('a verified paid Stripe return opens the localized thank-you screen', () => {
  assert.match(paymentDialog, /fetch\(`\/api\/payments\/verify\?session_id=/)
  assert.match(paymentDialog, /response\.ok\s*&&\s*data\.paid\s*&&\s*data\.tierId/)
  assert.match(paymentDialog, /successOpen\.value\s*=\s*true/)
  assert.match(paymentDialog, /t\('payment\.success\.title'\)/)
  assert.match(paymentDialog, /t\('payment\.success\.message'/)
  assert.match(paymentDialog, /t\('payment\.success\.continue'\)/)
})
