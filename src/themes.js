// Ready-made portal theme templates. Each id here has a matching `[data-theme="<id>"]` CSS block in
// public/index.html — add/edit a theme in both places together, or the picker will offer an id with no look.
const TEMPLATES = [
  { id: 'default', name: 'Default (Cyan)', group: 'Standard' },
  { id: 'independence', name: 'Independence / Madaraka / Jamhuri Day', group: 'Holidays' },
  { id: 'labour', name: 'Labour Day', group: 'Holidays' },
  { id: 'christmas', name: 'Christmas', group: 'Holidays' },
  { id: 'newyear', name: "New Year's", group: 'Holidays' },
  { id: 'valentine', name: "Valentine's Day", group: 'Holidays' },
  { id: 'easter', name: 'Easter', group: 'Holidays' },
  { id: 'eid', name: 'Eid', group: 'Holidays' },
  { id: 'diwali', name: 'Diwali', group: 'Holidays' },
  { id: 'mon', name: 'Monday — Blue', group: 'Weekday' },
  { id: 'tue', name: 'Tuesday — Teal', group: 'Weekday' },
  { id: 'wed', name: 'Wednesday — Violet', group: 'Weekday' },
  { id: 'thu', name: 'Thursday — Amber', group: 'Weekday' },
  { id: 'fri', name: 'Friday — Party Pink', group: 'Weekday' },
  { id: 'sat', name: 'Saturday — Green', group: 'Weekday' },
  { id: 'sun', name: 'Sunday — Calm Slate', group: 'Weekday' }
];
const IDS = new Set(TEMPLATES.map((t) => t.id));
const DEFAULT_WEEKDAY = { sunday: 'sun', monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu', friday: 'fri', saturday: 'sat' };
const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

module.exports = { TEMPLATES, IDS, DEFAULT_WEEKDAY, WEEKDAY_NAMES };
