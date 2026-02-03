// Storage Keys
export const STORAGE_KEY_SYMPTOMS = 'symptomTracker_symptoms';
export const STORAGE_KEY_ENTRIES = 'symptomTracker_entries';
export const STORAGE_KEY_NOTES = 'symptomTracker_notes';
export const STORAGE_KEY_MODE = 'symptomTracker_mode';
export const STORAGE_KEY_APP_MODE = 'symptomTracker_appMode';
export const STORAGE_KEY_STACK_ITEMS = 'symptomTracker_stackItems';
export const STORAGE_KEY_STACK_ENTRIES = 'symptomTracker_stackEntries';
export const STORAGE_KEY_PINNED = 'symptomTracker_pinned';
export const STORAGE_KEY_COPY_DAYS = 'symptomTracker_copyDays';
export const STORAGE_KEY_TREND_WINDOW = 'symptomTracker_trendWindow';

// Severity Configuration
export const severityLevels = [0, 1, 2, 3, 4, 5];
export const severityColors = {
  0: '#22c55e',
  1: '#4ade80',
  2: '#a3e635',
  3: '#facc15',
  4: '#fb923c',
  5: '#ef4444',
};
export const severityLabels = ['None', 'Minimal', 'Mild', 'Moderate', 'Severe', 'Extreme'];

// Tracking Modes
export const trackingModes = {
  simple: {
    label: 'Simple',
    description: 'One entry per day',
    periods: [{ id: 'daily', label: 'Daily', icon: '○' }],
  },
  ampm: {
    label: 'AM/PM',
    description: 'Morning and evening',
    periods: [
      { id: 'morning', label: 'AM', icon: '◐' },
      { id: 'evening', label: 'PM', icon: '◑' },
    ],
  },
};

// Default Symptoms
export const defaultSymptoms = [
  { id: 'red-neck-chest', name: 'Red neck/chest, blotchy skin tone', active: true, order: 0 },
  { id: 'penile-retraction', name: 'Penile retraction', active: true, order: 1 },
  { id: 'pee-dribble', name: 'Pee dribble', active: true, order: 2 },
  { id: 'urinary-urgency', name: 'Urinary urgency', active: true, order: 3 },
  { id: 'daytime-fatigue', name: 'Daytime fatigue', active: true, order: 4 },
  { id: 'irritability', name: 'Irritability', active: true, order: 5 },
  { id: 'social-withdrawal', name: 'Social withdrawal', active: true, order: 6 },
  { id: 'air-hunger-am', name: 'Air hunger AM', active: true, order: 7 },
  { id: 'anxiety-mental', name: 'Anxiety (mental: racing thoughts etc.)', active: true, order: 8 },
  { id: 'anxiety-physical', name: 'Anxiety (physical: chest pressure etc.)', active: true, order: 9 },
  { id: 'low-sexual-drive', name: 'Low sexual drive', active: true, order: 10 },
  { id: 'nerve-pain', name: 'Nerve pain / neuropathy', active: true, order: 11 },
  { id: 'headache', name: 'Headache', active: true, order: 12 },
  { id: 'dysphagia', name: 'Dysphagia', active: true, order: 13 },
  { id: 'fascial-tightness', name: 'Fascial and tendon tightness', active: true, order: 14 },
  { id: 'psoriasis', name: 'Psoriasis', active: true, order: 15 },
  { id: 'skinny-stool', name: 'Skinny stool', active: true, order: 16 },
  { id: 'diarrhea', name: 'Diarrhea / Loose stool', active: true, order: 17 },
  { id: 'brain-fog', name: 'Brain fog', active: true, order: 18 },
  { id: 'sugar-cravings', name: 'Sugar / alcohol cravings', active: true, order: 19 },
  { id: 'heartburn', name: 'Heartburn / bile reflux', active: true, order: 20 },
  { id: 'oral-thrush', name: 'Oral thrush', active: true, order: 21 },
  { id: 'farting-burping', name: 'Farting, burping', active: true, order: 22 },
  { id: 'cracking-joints', name: 'Cracking joints', active: true, order: 23 },
  { id: 'air-hunger-pm', name: 'Air hunger PM', active: true, order: 24 },
];

// Default Stack Items
export const defaultStackItems = [
  { id: 'b1-benfotiamine', name: 'B1 Benfotiamine', unit: 'mg', defaultDose: 200, active: true, order: 0 },
  { id: 'b2', name: 'B2', unit: 'mg', defaultDose: 250, active: true, order: 1 },
  { id: 'b3', name: 'B3', unit: 'mg', defaultDose: 50, active: true, order: 2 },
  { id: 'l-methylfolate', name: 'L-methylfolate', unit: 'mcg', defaultDose: 200, active: true, order: 3 },
  { id: 'methyl-b12', name: 'Methyl-B12', unit: 'mcg', defaultDose: 250, active: true, order: 4 },
  { id: 'd3', name: 'D3', unit: 'IU', defaultDose: 5000, active: true, order: 5 },
  { id: 'quercetin', name: 'Quercetin', unit: 'mg', defaultDose: 500, active: true, order: 6 },
  { id: 'vitamin-c', name: 'Vitamin C', unit: 'mg', defaultDose: 2000, active: true, order: 7 },
  { id: 'glycine', name: 'Glycine', unit: 'g', defaultDose: 3, active: true, order: 8 },
  { id: 'magnesium', name: 'Magnesium (biglycinate + threonate)', unit: 'mg', defaultDose: 600, active: true, order: 9 },
  { id: 'butyrate', name: 'Butyrate', unit: 'mg', defaultDose: 200, active: true, order: 10 },
  { id: 'ketotifen', name: 'Ketotifen', unit: 'mg', defaultDose: 1, active: true, order: 11 },
];

// UI Constants
export const DRAG_SENSITIVITY = 19;
export const HOLD_DELAY = 600;
export const SWIPE_THRESHOLD = 50;
export const SWIPE_TIME_LIMIT = 300;
