// Photograph a meal, have the model name its ingredients, correct the list, save it.
//
// Three states: `capture` (the file picker is opened for you, so the camera is one tap on a
// phone), `analyzing`, and `review`. Every path lands in `review`, including a failed analysis —
// a meal can always be typed by hand. The photo lives only as long as the request; nothing here
// stores it or hands it to `onSave`.

import { useEffect, useRef, useState } from 'react';
import { analyzeMeal } from '../food/mealApi';
import { shrinkImage } from '../food/shrinkImage';
import { solar } from './solarIcons';
import './mealCapture.css';

const pad = (n) => String(n).padStart(2, '0');
const timeValue = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

// Merge an HH:mm from the time input back onto a date.
const withTime = (date, value) => {
  const [h, m] = String(value).split(':').map(Number);
  const next = new Date(date);
  if (Number.isFinite(h) && Number.isFinite(m)) next.setHours(h, m, 0, 0);
  return next;
};

export default function MealCapture({ existing, onSave, onDelete, onClose }) {
  const [stage, setStage] = useState(existing ? 'review' : 'capture');
  const [preview, setPreview] = useState(null);      // object URL, revoked on unmount
  const [error, setError] = useState(null);
  const [name, setName] = useState(existing?.name || '');
  const [ingredients, setIngredients] = useState(existing?.ingredients || []);
  const [adding, setAdding] = useState('');
  const [source, setSource] = useState(existing?.source || 'photo');
  const [at, setAt] = useState(existing?.time ? new Date(existing.time) : new Date());

  const fileRef = useRef(null);
  const previewRef = useRef(null);
  previewRef.current = preview;

  // Open the picker as soon as the sheet mounts: on a phone that is the camera, one tap in.
  useEffect(() => {
    if (stage === 'capture') fileRef.current?.click();
  }, [stage]);

  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';                    // so picking the same file twice still fires
    if (!file) return;                      // cancelled the picker
    setError(null);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current); // replacing an earlier photo
    setPreview(URL.createObjectURL(file));
    setStage('analyzing');
    try {
      const image = await shrinkImage(file);
      const meal = await analyzeMeal({ image });
      setName(meal.name);
      setIngredients(meal.ingredients);
      setSource('photo');
      if (meal.ingredients.length === 0) setError("Couldn't see any food in that. Add the ingredients yourself.");
    } catch (err) {
      setError(err?.message || "Couldn't read that meal. Add the ingredients yourself.");
      setSource('manual');
    } finally {
      setStage('review');
    }
  };

  const addIngredient = () => {
    const value = adding.trim().toLowerCase();
    if (!value || ingredients.includes(value)) { setAdding(''); return; }
    setIngredients((prev) => [...prev, value]);
    setAdding('');
  };

  const rename = (index, value) => setIngredients((prev) =>
    prev.map((item, i) => (i === index ? value.toLowerCase() : item)));

  const remove = (index) => setIngredients((prev) => prev.filter((_, i) => i !== index));

  // Nothing to persist yet: keeps the Save button visibly disabled instead of silently no-op'ing.
  // Includes the pending "add an ingredient" field so Save isn't disabled while text sits there.
  const canSave = name.trim().length > 0 || ingredients.some((i) => i.trim().length > 0) || adding.trim().length > 0;

  const save = () => {
    const clean = ingredients.map((i) => i.trim().toLowerCase()).filter(Boolean);
    const pending = adding.trim().toLowerCase();
    if (pending && !clean.includes(pending)) clean.push(pending);
    if (clean.length === 0 && !name.trim()) return;
    onSave({ name: name.trim(), ingredients: clean, at, source });
    onClose();
  };

  return (
    <div className="mc-root" role="dialog" aria-label="Log a meal">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={pick}
      />

      <header className="mc-head">
        <button className="mc-x" onClick={onClose} aria-label="Cancel">✕</button>
        <h4>{existing ? 'Edit meal' : 'Log a meal'}</h4>
        {stage === 'review' && <button className="mc-save" onClick={save} disabled={!canSave}>Save</button>}
      </header>

      {stage === 'capture' && (
        <div className="mc-body mc-centered">
          <svg className="mc-bigicon" viewBox="0 0 24 24">{solar.camera}</svg>
          <p>Take a photo of your meal.</p>
          <button className="mc-primary" onClick={() => fileRef.current?.click()}>Open camera</button>
          <button className="mc-link" onClick={() => { setSource('manual'); setStage('review'); }}>
            Type it instead
          </button>
        </div>
      )}

      {stage === 'analyzing' && (
        <div className="mc-body mc-centered">
          {preview && <img className="mc-preview" src={preview} alt="" />}
          <div className="mc-spinner" />
          <p>Reading the ingredients…</p>
        </div>
      )}

      {stage === 'review' && (
        <div className="mc-body">
          {preview && <img className="mc-preview small" src={preview} alt="" />}
          {error && <div className="mc-error">{error}</div>}

          <label className="mc-field">
            <span>Meal</span>
            <input
              value={name}
              placeholder="What was it?"
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="mc-field">
            <span>Time</span>
            <input type="time" value={timeValue(at)} onChange={(e) => setAt(withTime(at, e.target.value))} />
          </label>

          <div className="mc-sec">INGREDIENTS · {ingredients.length}</div>
          {ingredients.map((item, index) => (
            <div className="mc-ing" key={index}>
              <input value={item} onChange={(e) => rename(index, e.target.value)} />
              <button onClick={() => remove(index)} aria-label={`Remove ${item}`}>✕</button>
            </div>
          ))}

          <div className="mc-ing add">
            <input
              value={adding}
              placeholder="Add an ingredient"
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addIngredient(); } }}
              onBlur={addIngredient}
            />
          </div>

          {existing && onDelete && (
            <button className="mc-danger" onClick={() => { onDelete(existing.key); onClose(); }}>
              Delete this meal
            </button>
          )}
        </div>
      )}
    </div>
  );
}
