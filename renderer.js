// ── State ────────────────────────────────────────────────────────────────────
let isRunning = false
let shouldStop = false
let totalInputTokens = 0
let totalOutputTokens = 0
let stepCount = 0

// Model pricing per million tokens
const MODEL_PRICING = {
  'claude-sonnet-4-5-20251101': { input: 3.00, output: 15.00 },
  'claude-opus-4-6-20250205':   { input: 5.00, output: 25.00 },
  'claude-haiku-4-5-20251001':  { input: 1.00, output:  5.00 }
}

// ── DOM Refs ─────────────────────────────────────────────────────────────────
const apiKeyInput     = document.getElementById('apiKey')
const toggleKeyBtn    = document.getElementById('toggleKey')
const modelSelect     = document.getElementById('modelSelect')
const targetAppSelect = document.getElementById('targetApp')
const maxStepsInput   = document.getElementById('maxSteps')
const stepDelayInput  = document.getElementById('stepDelay')
const instructionsTA  = document.getElementById('instructions')
const startBtn        = document.getElementById('startBtn')
const screenshotBtn   = document.getElementById('screenshotBtn')
const stopBtn         = document.getElementById('stopBtn')
const statusArea      = document.getElementById('statusArea')
const statusText      = document.getElementById('statusText')
const pulseDot        = document.getElementById('pulseDot')
const progressFill    = document.getElementById('progressFill')
const previewArea     = document.getElementById('previewArea')
const screenshotImg   = document.getElementById('screenshotImg')
const closePreviewBtn = document.getElementById('closePreview')
const activityLog     = document.getElementById('activityLog')
const clearLogBtn     = document.getElementById('clearLogBtn')
const permissionBanner = document.getElementById('permissionBanner')
const openSettingsBtn = document.getElementById('openSettingsBtn')
const targetAppHint   = document.getElementById('targetAppHint')

// Stat refs
const statSteps       = document.getElementById('statSteps')
const statInputTokens = document.getElementById('statInputTokens')
const statOutputTokens= document.getElementById('statOutputTokens')
const statCost        = document.getElementById('statCost')

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  loadSettings()
  await checkPermissions()

  targetAppSelect.addEventListener('change', () => {
    targetAppHint.textContent = targetAppSelect.value
    saveSettings()
  })

  targetAppHint.textContent = targetAppSelect.value
}

// ── Permissions ───────────────────────────────────────────────────────────────
async function checkPermissions() {
  const perms = await window.fractalAI.checkPermissions()
  if (perms.screen !== 'granted') {
    permissionBanner.classList.remove('hidden')
    await window.fractalAI.requestScreenPermission()
  }
}

openSettingsBtn?.addEventListener('click', () => {
  window.fractalAI.openPrivacySettings()
})

// ── Settings Persistence ──────────────────────────────────────────────────────
function saveSettings() {
  const data = {
    apiKey: apiKeyInput.value,
    model: modelSelect.value,
    targetApp: targetAppSelect.value,
    maxSteps: maxStepsInput.value,
    stepDelay: stepDelayInput.value
  }
  localStorage.setItem('fractalAISettings', JSON.stringify(data))
}

function loadSettings() {
  try {
    const raw = localStorage.getItem('fractalAISettings')
    if (!raw) return
    const data = JSON.parse(raw)
    if (data.apiKey)    apiKeyInput.value = data.apiKey
    if (data.model)     modelSelect.value = data.model
    if (data.targetApp) targetAppSelect.value = data.targetApp
    if (data.maxSteps)  maxStepsInput.value = data.maxSteps
    if (data.stepDelay) stepDelayInput.value = data.stepDelay
  } catch {}
}

;[apiKeyInput, modelSelect, targetAppSelect, maxStepsInput, stepDelayInput].forEach(el => {
  el.addEventListener('change', saveSettings)
})

// ── API Key Toggle ────────────────────────────────────────────────────────────
toggleKeyBtn.addEventListener('click', () => {
  if (apiKeyInput.type === 'password') {
    apiKeyInput.type = 'text'
  } else {
    apiKeyInput.type = 'password'
  }
})

// ── Preview Screenshot ────────────────────────────────────────────────────────
screenshotBtn.addEventListener('click', async () => {
  screenshotBtn.disabled = true
  screenshotBtn.textContent = 'Capturing…'
  const result = await window.fractalAI.captureScreen()
  screenshotBtn.disabled = false
  screenshotBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg> Preview Screen`

  if (result.success) {
    screenshotImg.src = `data:image/jpeg;base64,${result.image}`
    previewArea.classList.remove('hidden')
    permissionBanner.classList.add('hidden')
    logEntry('info', '📸', `Screen captured — ${result.width}×${result.height}px`)
  } else {
    logEntry('error', '⚠️', `Screen capture failed: ${result.error}`)
    permissionBanner.classList.remove('hidden')
  }
})

closePreviewBtn.addEventListener('click', () => {
  previewArea.classList.add('hidden')
})

// ── Clear Log ─────────────────────────────────────────────────────────────────
clearLogBtn.addEventListener('click', () => {
  activityLog.innerHTML = ''
})

// ── Stop ──────────────────────────────────────────────────────────────────────
stopBtn.addEventListener('click', () => {
  shouldStop = true
  logEntry('error', '🛑', 'Stop requested — will halt after current step')
  setStatus('Stopping…', 'running')
})

// ── Start Session ─────────────────────────────────────────────────────────────
startBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim()
  if (!apiKey) {
    logEntry('error', '⚠️', 'Please enter your Anthropic API key in the settings panel')
    return
  }
  if (!apiKey.startsWith('sk-ant-')) {
    logEntry('error', '⚠️', 'API key should start with "sk-ant-" — please check it')
    return
  }
  const instructions = instructionsTA.value.trim()
  if (!instructions) {
    logEntry('error', '⚠️', 'Please describe what you want the AI to build or do')
    return
  }

  saveSettings()
  resetStats()
  await runSession(apiKey, instructions)
})

// ── Core Session Loop ─────────────────────────────────────────────────────────
async function runSession(apiKey, userInstructions) {
  isRunning = true
  shouldStop = false
  const maxSteps = parseInt(maxStepsInput.value) || 50
  const stepDelay = parseInt(stepDelayInput.value) || 600
  const model = modelSelect.value
  const targetApp = targetAppSelect.value

  startBtn.disabled = true
  statusArea.classList.remove('hidden')
  setStatus('Starting session…', 'running')
  logEntry('info', '🚀', `Starting AI session | Model: ${model.split('-')[1]} | Target: ${targetApp}`)
  logEntry('ai', '🤖', `Task: "${userInstructions}"`)

  // System prompt
  const systemPrompt = `You are an AI assistant controlling the Fractal Audio ${targetApp} application on macOS using the computer_use tool.

Your job is to complete the following task by interacting with the application UI:
- You will receive screenshots of the screen after each action
- Analyze the screenshot carefully before each action
- Be methodical: find UI elements accurately before clicking
- If ${targetApp} is not visible, click its icon in the Dock or use the menubar to bring it to front
- When the task is complete, call the computer_use tool with type "screenshot" and then respond with "TASK COMPLETE: [brief description of what was accomplished]"
- If you encounter an error you cannot recover from, respond with "TASK FAILED: [reason]"

Important reminders:
- Coordinates you provide will be in the physical pixel space of the screenshot
- Take your time and be accurate — it's better to be slow and correct than fast and wrong
- If an action doesn't seem to have worked, try again or try a different approach`

  const messages = []
  let currentStep = 0

  try {
    // Initial screenshot
    setStatus('Capturing initial screenshot…', 'running')
    logEntry('info', '📸', 'Taking initial screenshot…')

    const initCapture = await window.fractalAI.captureScreen()
    if (!initCapture.success) {
      throw new Error(`Screen capture failed: ${initCapture.error}`)
    }

    // First user message with screenshot
    messages.push({
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: initCapture.image
          }
        },
        {
          type: 'text',
          text: `Here is the current state of the screen. Please complete this task:\n\n${userInstructions}`
        }
      ]
    })

    // Main loop
    while (currentStep < maxSteps && !shouldStop) {
      currentStep++
      stepCount++
      updateProgress(currentStep, maxSteps)
      setStatus(`Step ${currentStep} of ${maxSteps} — thinking…`, 'running')
      logEntry('step', '⚡', `Step ${currentStep}/${maxSteps}`)

      // Call Claude API
      const response = await callClaudeAPI(apiKey, model, systemPrompt, messages)

      if (!response.success) {
        throw new Error(response.error)
      }

      // Track token usage
      totalInputTokens += response.usage?.input_tokens || 0
      totalOutputTokens += response.usage?.output_tokens || 0
      updateStats()

      const assistantMessage = response.message
      messages.push({ role: 'assistant', content: assistantMessage.content })

      // Process response content
      let taskDone = false
      let taskFailed = false
      let screenshotRequested = false
      const actionsToExecute = []

      for (const block of assistantMessage.content) {
        if (block.type === 'text') {
          logEntry('ai', '💬', block.text.substring(0, 300) + (block.text.length > 300 ? '…' : ''))

          if (block.text.includes('TASK COMPLETE:')) {
            taskDone = true
            const completionMsg = block.text.split('TASK COMPLETE:')[1]?.trim() || 'Task finished successfully'
            logEntry('success', '✅', `Task complete: ${completionMsg}`)
          } else if (block.text.includes('TASK FAILED:')) {
            taskFailed = true
            const failMsg = block.text.split('TASK FAILED:')[1]?.trim() || 'Unknown error'
            logEntry('error', '❌', `Task failed: ${failMsg}`)
          }

        } else if (block.type === 'tool_use' && block.name === 'computer') {
          const action = block.input
          logEntry('action', '🖱️', describeAction(action))
          actionsToExecute.push({ id: block.id, action })

          if (action.action === 'screenshot') {
            screenshotRequested = true
          }
        }
      }

      if (taskDone || taskFailed || shouldStop) {
        break
      }

      // Execute all actions
      const toolResults = []

      for (const { id, action } of actionsToExecute) {
        if (action.action === 'screenshot') {
          // Don't execute anything, just take a new screenshot
          continue
        }

        setStatus(`Step ${currentStep} — executing: ${describeAction(action)}`, 'running')
        const execResult = await window.fractalAI.executeAction(mapAction(action))

        if (!execResult.success) {
          logEntry('error', '⚠️', `Action failed: ${execResult.error}`)
        }

        await sleep(stepDelay)
      }

      // Always take a fresh screenshot after actions and send back to Claude
      setStatus(`Step ${currentStep} — capturing result…`, 'running')
      await sleep(300)
      const newCapture = await window.fractalAI.captureScreen()

      if (!newCapture.success) {
        logEntry('error', '⚠️', `Screenshot failed: ${newCapture.error}`)
        break
      }

      // Update preview
      screenshotImg.src = `data:image/jpeg;base64,${newCapture.image}`
      previewArea.classList.remove('hidden')

      // Build tool results for all tool_use blocks
      const toolUseIds = assistantMessage.content
        .filter(b => b.type === 'tool_use')
        .map(b => b.id)

      const userContent = []

      // Add tool results for each tool_use
      for (const toolId of toolUseIds) {
        userContent.push({
          type: 'tool_result',
          tool_use_id: toolId,
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: newCapture.image
              }
            }
          ]
        })
      }

      if (userContent.length === 0) {
        // No tool use — add screenshot as new user turn
        userContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: newCapture.image
          }
        })
        userContent.push({
          type: 'text',
          text: 'Here is the updated screen. Please continue with the next step.'
        })
      }

      messages.push({ role: 'user', content: userContent })
    }

    if (shouldStop) {
      setStatus('Stopped by user', 'error')
      logEntry('error', '🛑', 'Session stopped by user')
    } else if (currentStep >= maxSteps) {
      setStatus('Max steps reached', 'error')
      logEntry('error', '⏱️', `Reached maximum of ${maxSteps} steps. Try increasing the limit or breaking the task into smaller steps.`)
    } else {
      setStatus('Session complete ✓', 'success')
    }

  } catch (err) {
    setStatus('Error: ' + err.message, 'error')
    logEntry('error', '💥', `Session error: ${err.message}`)
    console.error(err)
  } finally {
    isRunning = false
    startBtn.disabled = false
  }
}

// ── Claude API Call ───────────────────────────────────────────────────────────
async function callClaudeAPI(apiKey, model, systemPrompt, messages) {
  try {
    const body = {
      model,
      max_tokens: 4096,
      system: systemPrompt,
      tools: [
        {
          type: 'computer_20241022',
          name: 'computer',
          display_width_px: 2560,
          display_height_px: 1600
        }
      ],
      messages
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'computer-use-2024-10-22',
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.error?.message || `API error ${response.status}`
      }
    }

    return {
      success: true,
      message: data,
      usage: data.usage
    }

  } catch (err) {
    return { success: false, error: err.message }
  }
}

// ── Action Mapping ────────────────────────────────────────────────────────────
// Claude computer_use sends action in block.input.action
function mapAction(input) {
  const type = input.action
  switch (type) {
    case 'left_click':
    case 'right_click':
    case 'double_click':
    case 'mouse_move':
      return { type, coordinate: input.coordinate }
    case 'type':
      return { type: 'type', text: input.text }
    case 'key':
      return { type: 'key', text: input.text }
    case 'scroll':
      return { type: 'scroll', coordinate: input.coordinate, direction: input.direction, amount: input.amount }
    default:
      return { type }
  }
}

function describeAction(action) {
  const type = action.action || action.type
  switch (type) {
    case 'left_click':   return `Click at (${action.coordinate?.join(', ')})`
    case 'right_click':  return `Right-click at (${action.coordinate?.join(', ')})`
    case 'double_click': return `Double-click at (${action.coordinate?.join(', ')})`
    case 'mouse_move':   return `Move mouse to (${action.coordinate?.join(', ')})`
    case 'type':         return `Type: "${action.text?.substring(0, 40)}${action.text?.length > 40 ? '…' : ''}"`
    case 'key':          return `Key: ${action.text}`
    case 'scroll':       return `Scroll ${action.direction} at (${action.coordinate?.join(', ')})`
    case 'screenshot':   return 'Take screenshot'
    default:             return `Action: ${type}`
  }
}

// ── UI Helpers ────────────────────────────────────────────────────────────────
function setStatus(text, state = 'running') {
  statusText.textContent = text
  pulseDot.className = 'pulse-dot ' + state
}

function updateProgress(current, max) {
  const pct = Math.min((current / max) * 100, 100)
  progressFill.style.width = pct + '%'
}

function logEntry(type, icon, text) {
  const div = document.createElement('div')
  div.className = `log-entry log-${type}`
  div.innerHTML = `<span class="log-icon">${icon}</span><span>${escapeHtml(text)}</span>`
  activityLog.appendChild(div)
  activityLog.scrollTop = activityLog.scrollHeight
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function resetStats() {
  totalInputTokens = 0
  totalOutputTokens = 0
  stepCount = 0
  updateStats()
  progressFill.style.width = '0%'
}

function updateStats() {
  statSteps.textContent = stepCount
  statInputTokens.textContent = totalInputTokens.toLocaleString()
  statOutputTokens.textContent = totalOutputTokens.toLocaleString()

  const pricing = MODEL_PRICING[modelSelect.value] || MODEL_PRICING['claude-sonnet-4-5-20251101']
  const cost = (totalInputTokens / 1_000_000) * pricing.input +
               (totalOutputTokens / 1_000_000) * pricing.output
  statCost.textContent = '$' + cost.toFixed(4)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init()
