import Logger from './Logger.js'

export const PROTOTYPE_ALARM = 'oa2-lesson-notification-prototype'
export const PROTOTYPE_URL = 'https://tahvel.edu.ee/#/journal/433792/edit?oa2NewEntry=1'

/** Register the manually triggered one-minute notification prototype. */
export function registerLessonNotificationPrototype() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== 'scheduleLessonNotificationPrototype') return false
    // Only the extension popup may schedule this deliberately hardcoded demo.
    if (sender.id !== chrome.runtime.id || sender.tab) return false
    ;(async() => {
      if (await chrome.notifications.getPermissionLevel() !== 'granted') {
        throw new Error('Chrome’i märguanded pole lubatud')
      }
      await chrome.alarms.create(PROTOTYPE_ALARM, { delayInMinutes: 1 })
      sendResponse({ success: true })
    })().catch(error => sendResponse({ success: false, error: error.message }))
    return true
  })
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name !== PROTOTYPE_ALARM) return
    chrome.notifications.create(PROTOTYPE_ALARM, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon128.png'),
      title: 'ÕA2 proov: Tarkvara arendus · TAK25',
      message: 'Klõpsa, et avada päeviku uue sissekande vorm.',
      requireInteraction: true
    }).catch(error => Logger.error('Proovimärguande kuvamine ebaõnnestus', error))
  })
  chrome.notifications.onClicked.addListener(notificationId => {
    if (notificationId !== PROTOTYPE_ALARM) return
    // A fresh tab avoids replacing an existing unsaved journal form.
    chrome.tabs.create({ url: PROTOTYPE_URL, active: true })
      .then(() => chrome.notifications.clear(notificationId))
      .catch(error => Logger.error('Proovipäeviku avamine ebaõnnestus', error))
  })
}
