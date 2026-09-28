/**
 * categories.js — the expense category taxonomy.
 *
 * CATEGORY_GROUPS drives both the Add Expense dropdown AND the Excel/PDF
 * export grouping — they're the same groups now, based on the site
 * team's own breakdown:
 *   1. Accommodation
 *   2. Block Production (Store, Cement, Burnt Bricks, Water, Sharp Sand)
 *   3. Main Work (Chemical, Setting Out Materials, Security, PPE, Granite, Site Office)
 *   4. Excavation of Trenches
 *   5. Concrete Works (column base through roof beam — the team's own
 *      breakdown: Column Blinding, Column Base, Trenches Casting, Columns
 *      Before Slab, Slab, Kickers, Column on Slab, Lintel, Beams & First
 *      Floor Slab, First Floor Columns, First Floor Lintel, Roof Beam)
 *   6. Transportation of Tools
 *   7. Ach Shittu Materials
 *   8. Workmanship
 *   9. Other Expenses — catch-all for anything not covered above
 *
 * These group names are also what the exported workbook uses as its
 * sheet/tab names, so pick a category here and it lands in the matching
 * sheet automatically.
 *
 * NOTE ON "Excavation of Trenches" vs "Concrete Works":
 * Per the site team (Ilesanmi, 9/9): trench work is identified by its
 * excavation length in the report (e.g. "Excavation of trenches 61m",
 * "Trenches digging 81m") — that's pure digging/excavation and stays
 * under Excavation of Trenches. Everything to do with casting concrete
 * — including column base work, which the team confirmed is "mainly
 * concrete work" — goes under Concrete Works, even when the line
 * mentions "trench" (e.g. "Trenches casting" is Concrete Works, while
 * "Trenches digging" is Excavation of Trenches). Column Base Work and
 * Column Base Materials, which used to be their own separate groups,
 * are folded into Concrete Works accordingly — do not re-split them.
 */
const CATEGORY_GROUPS = {
  'Accommodation': ['Hotel Accommodation', 'House Rent', 'House Cleaning', 'House Setup Materials'],
  'Block Production': ['Store Construction', 'Cement', 'Burnt Bricks', 'Water Supply', 'Sharp Sand', 'plaster Sand','Block Moulding Labour', 'Block Production'],
  'Main Work': ['Chemical', 'Setting Out Materials', 'Security', 'PPE & Safety Equipment', 'Granite', 'Site Office'],
  'Excavation of Trenches': ['Excavation of Trenches', 'Excavation Equipment Hire'],
  'Concrete Works': [
    'Column Blinding', 'Column Base', 'Trenches Casting', 'Columns Before Slab', 'Slab',
    'Kickers', 'Column on Slab', 'Lintel', 'Beams & First Floor Slab', 'First Floor Columns',
    'First Floor Lintel', 'Roof Beam', 'Mason/Poker Labour', 'Poker Rental', 'Bentonite'
  ],
  'Transportation of Tools': ['Transportation of Tools', 'Fuel for Transportation'],
  'Ach Shittu Materials': ['Ach Shittu Materials (Bulk Purchase)'],
  'Workmanship': ['Mason', 'Carpenter', 'Electrician', 'Plumber', 'Welder', 'Painter', 'General Labour', 'Workmanship (Other)'],
  'Other Expenses': [
    'Iron Rods', 'Timber', 'Roofing Materials', 'Paint', 'Tiles', 'Plumbing Materials',
    'Electrical Materials', 'Doors & Windows', 'Glass & Aluminium', 'Blocks', 'Bricks',
    'Generator Fuel', 'Diesel', 'Petrol', 'Internet & Communication',
    'Equipment Hire', 'Machinery Repair', 'Tool Purchase', 'Haulage', 'Loading & Offloading',
    'Site Cleaning', 'Office Supplies', 'Waste Disposal', 'Miscellaneous'
  ]
};

const CATEGORY_FLAT = Object.values(CATEGORY_GROUPS).flat();

// Reverse lookup: leaf category -> its group. Used by the Reports page
// group filter, the Excel/PDF export, and the Final Report generator to
// file each expense into the right sheet.
const CATEGORY_GROUP_OF = {};
Object.keys(CATEGORY_GROUPS).forEach(g => CATEGORY_GROUPS[g].forEach(c => { CATEGORY_GROUP_OF[c] = g; }));

const CATEGORY_GROUP_ORDER = Object.keys(CATEGORY_GROUPS);

function populateCategorySelect(selectEl, includeBlank) {
  let html = includeBlank ? '<option value="">All categories</option>' : '';
  Object.keys(CATEGORY_GROUPS).forEach(group => {
    html += `<optgroup label="${group}">`;
    CATEGORY_GROUPS[group].forEach(c => {
      html += `<option value="${c}">${c}</option>`;
    });
    html += `</optgroup>`;
  });
  selectEl.innerHTML = html;
}

/**
 * Keyword synonyms for auto-categorizing free-text expense descriptions
 * (used by the Excel import feature). Each key is a lowercase keyword to
 * look for inside a description; the value is the exact category it
 * should map to. Checked in array order, so more specific terms must
 * come before more general ones — this list has been tested against
 * real site-report phrasing rather than idealized wording. In
 * particular: generic "rent" used to catch "poker rent" before it
 * reached the specific rule for it, and generic "casting"/"trench"
 * used to swallow phrases that were really trench-prep or column work.
 * The order below fixes both.
 */
const CATEGORY_KEYWORDS = [
  ['hotel', 'Hotel Accommodation'], ['lodge', 'Hotel Accommodation'],
  ['house rent', 'House Rent'],
  ['house clean', 'House Cleaning'], ['cleaning', 'House Cleaning'],
  ['house setup', 'House Setup Materials'],
  ['store construction', 'Store Construction'],
  ['chemical', 'Chemical'], ['herbicide', 'Chemical'], ['spray', 'Chemical'], ['weed', 'Chemical'],
  ['setting out', 'Setting Out Materials'],
  ['security', 'Security'], ['guard', 'Security'], ['watchman', 'Security'],
  ['ppe', 'PPE & Safety Equipment'], ['safety', 'PPE & Safety Equipment'], ['helmet', 'PPE & Safety Equipment'], ['boot', 'PPE & Safety Equipment'],
  ['site office', 'Site Office'],

  // --- Concrete Works: most specific / unique phrasing first ---
  ['first floor lintel', 'First Floor Lintel'],
  ['first floor columns', 'First Floor Columns'], ['first floor column', 'First Floor Columns'],
  ['beams&firstfloor slab', 'Beams & First Floor Slab'],
  ['beams & first floor slab', 'Beams & First Floor Slab'],
  ['beams and first floor slab', 'Beams & First Floor Slab'],
  ['roof beam', 'Roof Beam'],
  ['column on slab', 'Column on Slab'],
  ['columns before slab', 'Columns Before Slab'], ['column before slab', 'Columns Before Slab'],
  ['kickers', 'Kickers'],
  ['lintel', 'Lintel'],
  ['slab', 'Slab'],

  ['column blinding', 'Column Blinding'],
  ['column base excavation', 'Column Base'],
  ['column base(digging', 'Column Base'], ['column base (digging', 'Column Base'],
  ['column base/digging', 'Column Base'],
  ['column base', 'Column Base'], ['columb base', 'Column Base'],
  ['column dug', 'Column Base'], ['column blind', 'Column Base'],
  ['column re-excavation', 'Column Base'], ['column re-digging', 'Column Base'],
  ['columns re-digging', 'Column Base'],
  ['digging column', 'Column Base'], ['digging single column', 'Column Base'],
  ['column digging', 'Column Base'],
  ['removal of sand in column base', 'Column Base'],
  ['sand evacuation from column base', 'Column Base'],
  ['evacuation of sand in column base', 'Column Base'],
  ['timbering to column', 'Column Base'],

  ['trenches casting', 'Trenches Casting'], ['trench casting', 'Trenches Casting'],
  ['casting of trench', 'Trenches Casting'],

  // --- Excavation of Trenches: trench prep/digging phrases, checked
  // BEFORE the generic "casting" catch-all below since several mention
  // "casting" as their purpose but are prep work, not the casting
  // itself (e.g. "sand evacuation trenches to receive casting") ---
  ['trench excavation', 'Excavation of Trenches'],
  ['trenches excavation', 'Excavation of Trenches'],
  ['excavation of trench', 'Excavation of Trenches'],
  ['trench preparation', 'Excavation of Trenches'],
  ['trenches digging', 'Excavation of Trenches'], ['trench digging', 'Excavation of Trenches'],
  ['trenches dug', 'Excavation of Trenches'], ['trench dug', 'Excavation of Trenches'],
  ['sand evacuation to prepare for trenches', 'Excavation of Trenches'],
  ['sand evacuation trenches', 'Excavation of Trenches'],
  ['evacuation of sand in trenches', 'Excavation of Trenches'],
  ['clearing trenches', 'Excavation of Trenches'],

  ['casting of column', 'Column Base'],
  ['cement casting', 'Column Base'],
  ['column base casting', 'Column Base'],
  ['casting', 'Column Base'],

  ['mason/poker', 'Mason/Poker Labour'], ['mason & poker', 'Mason/Poker Labour'],
  ['mason and poker', 'Mason/Poker Labour'], ['mason& poker', 'Mason/Poker Labour'],
  ['poker rent', 'Poker Rental'], ['poker operator', 'Mason/Poker Labour'],
  ['bentonite', 'Bentonite'],

  ['trench', 'Excavation of Trenches'],
  ['excavation', 'Excavation of Trenches'],

  // --- existing keywords, unchanged ---
  ['sharp sand', 'Sharp Sand'], ['sand', 'Sharp Sand'],
  ['granite', 'Granite'],
  ['cement', 'Cement'],
  ['burnt brick', 'Burnt Bricks'], ['brick', 'Bricks'],
  ['water', 'Water Supply'],
  ['transportation of tool', 'Transportation of Tools'], ['transport', 'Transportation of Tools'],
  ['fuel for transport', 'Fuel for Transportation'],
  ['ach shittu', 'Ach Shittu Materials (Bulk Purchase)'], ['shittu', 'Ach Shittu Materials (Bulk Purchase)'],
  ['mason', 'Mason'], ['carpenter', 'Carpenter'], ['electrician', 'Electrician'],
  ['plumber', 'Plumber'], ['welder', 'Welder'], ['painter', 'Painter'],
  ['labour', 'General Labour'], ['labor', 'General Labour'], ['wages', 'General Labour'], ['workmanship', 'Workmanship (Other)'],
  ['iron rod', 'Iron Rods'], ['rebar', 'Iron Rods'],
  ['timber', 'Timber'], ['wood', 'Timber'],
  ['roofing', 'Roofing Materials'], ['roof sheet', 'Roofing Materials'], ['zinc', 'Roofing Materials'],
  ['paint', 'Paint'],
  ['tile', 'Tiles'],
  ['plumbing', 'Plumbing Materials'], ['pipe', 'Plumbing Materials'],
  ['electrical', 'Electrical Materials'], ['wire', 'Electrical Materials'], ['cable', 'Electrical Materials'],
  ['door', 'Doors & Windows'], ['window', 'Doors & Windows'],
  ['glass', 'Glass & Aluminium'], ['aluminium', 'Glass & Aluminium'], ['aluminum', 'Glass & Aluminium'],
  ['block', 'Blocks'],
  ['generator', 'Generator Fuel'],
  ['diesel', 'Diesel'],
  ['petrol', 'Petrol'], ['fuel', 'Petrol'],
  ['internet', 'Internet & Communication'], ['airtime', 'Internet & Communication'], ['data', 'Internet & Communication'],
  ['equipment hire', 'Equipment Hire'], ['machine hire', 'Equipment Hire'],
  ['machinery repair', 'Machinery Repair'], ['repair', 'Machinery Repair'],
  ['tool purchase', 'Tool Purchase'], ['tool', 'Tool Purchase'],
  ['haulage', 'Haulage'],
  ['loading', 'Loading & Offloading'], ['offloading', 'Loading & Offloading'],
  ['site clean', 'Site Cleaning'],
  ['office supplies', 'Office Supplies'], ['stationery', 'Office Supplies'],
  ['waste', 'Waste Disposal'], ['disposal', 'Waste Disposal']
];

/**
 * Guess the best-matching category for a free-text description.
 * Returns { category, confidence } where confidence is 'exact',
 * 'keyword', or 'none' (falls back to 'Miscellaneous').
 */
function guessCategory(text) {
  if (!text) return { category: 'Miscellaneous', confidence: 'none' };
  const t = String(text).trim();
  const tLower = t.toLowerCase();

  // 1. Exact match against a real category name (case-insensitive).
  const exact = CATEGORY_FLAT.find(c => c.toLowerCase() === tLower);
  if (exact) return { category: exact, confidence: 'exact' };

  // 2. Keyword search within the text.
  for (const [keyword, category] of CATEGORY_KEYWORDS) {
    if (tLower.indexOf(keyword) !== -1) {
      return { category, confidence: 'keyword' };
    }
  }

  // 3. No match — flag it so the person reviews it manually.
  return { category: 'Miscellaneous', confidence: 'none' };
}
