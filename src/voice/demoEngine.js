// Dev-only stand-in for a voice engine (open the app with ?talkdemo): silent, no backend, no mic,
// and nothing it "records" leaves the screen (TalkMode keeps demo answers to itself). It walks the
// screen through its states, answering each symptom, so the talk mode layout and animation can be
// checked without a live session.
export const createDemoEngine = ({ checkin, onState, onCaption, onLevel, onEnd }) => {
  let timers = [];
  let stopped = false;
  const later = (ms, fn) => timers.push(setTimeout(() => !stopped && fn(), ms));

  const ask = (result) => {
    if (!result.next) {
      onCaption({ who: 'app', text: 'That is everything.' });
      later(1500, () => stop('finished'));
      return;
    }
    onState('speaking');
    onCaption({ who: 'app', text: result.next.say });
    onCaption({ who: 'user', text: '' });
    later(3400, () => {
      onState('listening');
      later(1800, () => {
        onState('thinking');
        later(500, () => ask(checkin.handle('record_symptom', { symptom_id: result.next.symptom_id, severity: result.next.last_time ?? 1 })));
      });
    });
  };

  const stop = (reason = 'paused') => {
    if (stopped) return;
    stopped = true;
    timers.forEach(clearTimeout);
    timers = [];
    onEnd(reason, { turns: 0 });
  };

  const wave = setInterval(() => onLevel(Math.random() * 0.6), 90);

  return {
    start: () => {
      onState('connecting');
      later(3500, () => ask(checkin.start()));
    },
    stop: () => {
      clearInterval(wave);
      stop();
    },
    setMuted: () => {},
    sendText: () => {},
    advance: () => {},
  };
};
