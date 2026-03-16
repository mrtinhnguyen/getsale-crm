import { reportWarning } from './error-reporter';

const NOTIFICATION_SOUND_PATH = '/notification.wav';

let sharedContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedContext) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) sharedContext = new Ctor();
  }
  return sharedContext;
}

/** Run callback once after the next user gesture (required for AudioContext on modern browsers). */
function afterFirstUserGesture(cb: () => void): void {
  const run = () => {
    document.removeEventListener('click', run);
    document.removeEventListener('keydown', run);
    document.removeEventListener('touchstart', run);
    cb();
  };
  document.addEventListener('click', run, { once: true });
  document.addEventListener('keydown', run, { once: true });
  document.addEventListener('touchstart', run, { once: true });
}

/** Короткий звук уведомления (Web Audio API). Не воспроизводит, пока контекст не разблокирован жестом. */
function playBeepNotification(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    afterFirstUserGesture(() => {
      ctx.resume().then(() => playBeepNotification()).catch((err) => {
      reportWarning('AudioContext resume failed', { error: err, action: 'notification-sound' });
    });
    });
    return;
  }
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {
    reportWarning('Play beep notification failed', { error: e, action: 'notification-sound' });
  }
}

/** Воспроизвести звук уведомления: WAV или «динг» (fallback). */
export function playNotificationSound(): void {
  if (typeof window === 'undefined') return;
  const audio = new Audio(NOTIFICATION_SOUND_PATH);
  audio.volume = 0.6;
  audio.play().then(() => {}).catch((err) => {
    reportWarning('Notification WAV play failed, using beep fallback', { error: err, action: 'notification-sound' });
    playBeepNotification();
  });
  audio.addEventListener('error', () => playBeepNotification(), { once: true });
}
