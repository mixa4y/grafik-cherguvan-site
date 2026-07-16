(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const KEY = "dutyWizardV4";
  const PREVIOUS_KEY = "dutyWizardV3";
  const LEGACY_KEY = "dutyWizardV2";
  const SHIFT_DURATIONS = [1, 2, 3, 4, 6, 8, 12, 24];
  const MAX_SHIFTS = 24;
  const MAX_PEOPLE_PER_SHIFT = 30;

  const steps = [
    ["Початок", "Період і початок розрахункової доби"],
    ["Пости", "Створення постів і спільного переліку змін"],
    ["Люди", "Розрахований склад і підтвердження кожної зміни"],
    ["Перевірка", "Початкове призначення на пости"],
    ["Переходи", "Постійна робота, маршрути та ротація"],
    ["Графік", "Перевірка та формування"],
  ];

  const clone = (value) => JSON.parse(JSON.stringify(value));

  function clamp(value, min, max) {
    const number = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(number) ? number : min));
  }

  function makeRotation() {
    return { mode: "rotate" };
  }

  function makeShiftRule() {
    return {
      movement: "team",
      routeMode: "auto",
      frequency: 1,
      route: [],
      manualDays: {},
    };
  }

  function makePoint(index = 0, shiftCount = 0) {
    return {
      name: "",
      duration: 4,
      shiftMode: "alternate",
      peopleRequired: 1,
      peopleMode: "rotate",
      shiftIds: Array.from({ length: shiftCount }, (_, shift) => shift),
      requirements: Array(shiftCount).fill(1),
      memberModes: Array(shiftCount).fill("rotate"),
      closed: [],
      rotations: Array.from({ length: shiftCount }, makeRotation),
    };
  }

  function makePerson(shift = 0, point = 0) {
    return { name: "", phone: "", unit: "", point, shift };
  }

  const defaults = {
    step: 1,
    startDate: "",
    dayStart: "08:00",
    daysCount: 7,
    pointsCount: 0,
    shiftsCount: 0,
    peoplePerShift: 0,
    points: [],
    peopleCount: 0,
    people: [],
    shiftRules: [],
    shiftTargets: {},
    shiftConfirmed: {},
    validationAttempted: {},
    postLibrary: [],
    nextTemplateId: 1,
    postDraft: null,
    editingPoint: null,
    choosingPost: false,
    lastSavedPoint: null,
    peopleConfirmed: false,
    assignmentMode: "auto",
    hybridEdited: false,
    shortageMode: "placeholders",
    schedule: null,
  };

  function inferShiftCount(raw) {
    const points = Array.isArray(raw.points) ? raw.points : [];
    const people = Array.isArray(raw.people) ? raw.people : [];
    return Math.max(
      0,
      ...points.map((point) =>
        Math.max(
          point.requirements?.length || 0,
          ...(point.shiftIds || []).map((shift) => Number(shift) + 1),
        ),
      ),
      ...people.map((person) => Number(person.shift) + 1),
    );
  }

  function migrate(raw, fromLegacy = false) {
    const source = raw && typeof raw === "object" ? raw : {};
    const next = { ...clone(defaults), ...source };
    const inferredShifts = inferShiftCount(source);

    next.points = Array.isArray(source.points)
      ? clone(source.points)
      : clone(defaults.points);
    next.people = Array.isArray(source.people)
      ? clone(source.people)
      : clone(defaults.people);
    next.pointsCount = next.points.length;
    next.shiftsCount = source.shiftsCount ?? inferredShifts;
    next.shiftRules = Array.isArray(source.shiftRules)
      ? clone(source.shiftRules)
      : [];
    next.shiftTargets = source.shiftTargets || {};
    next.shiftConfirmed = source.shiftConfirmed || {};
    next.validationAttempted = source.validationAttempted || {};
    next.postLibrary = Array.isArray(source.postLibrary)
      ? clone(source.postLibrary)
      : next.points.map((point, index) => ({
          id: index + 1,
          name: point.name || `Пост ${index + 1}`,
          point: clone(point),
        }));
    next.nextTemplateId = Math.max(
      Number(source.nextTemplateId) || 1,
      1 + Math.max(0, ...next.postLibrary.map((item) => Number(item.id) || 0)),
    );
    next.postDraft = fromLegacy ? null : source.postDraft || null;
    next.editingPoint = fromLegacy ? null : source.editingPoint ?? null;
    next.choosingPost = fromLegacy ? false : Boolean(source.choosingPost);
    next.lastSavedPoint = fromLegacy ? null : source.lastSavedPoint ?? null;
    next.assignmentMode = ["auto", "hybrid", "manual"].includes(
      source.assignmentMode,
    )
      ? source.assignmentMode
      : "auto";
    next.hybridEdited = Boolean(source.hybridEdited);
    if (fromLegacy) {
      next.schedule = null;
      next.peopleConfirmed = false;
      next.shiftConfirmed = {};
    }
    return next;
  }

  function load() {
    try {
      const current = localStorage.getItem(KEY);
      if (current) return migrate(JSON.parse(current));
      const previous = localStorage.getItem(PREVIOUS_KEY);
      if (previous) return migrate(JSON.parse(previous), true);
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) return migrate(JSON.parse(legacy), true);
    } catch {
      // A corrupt saved state should never prevent the app from opening.
    }
    return clone(defaults);
  }

  let state = load();

  function save() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  function today() {
    const date = new Date();
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 10);
  }

  function esc(value) {
    return String(value ?? "").replace(
      /[&<>"]/g,
      (character) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[
          character
        ],
    );
  }

  const iconPaths = Object.freeze({
    spreadsheet:
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h2M14 13h2M8 17h2M14 17h2"/>',
    printer:
      '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14" rx="1"/>',
    trash:
      '<path d="M3 6h18M8 6V4c0-1 .9-2 2-2h4c1.1 0 2 1 2 2v2M19 6l-1 14c-.1 1.1-1 2-2.1 2H8.1C7 22 6.1 21.1 6 20L5 6M10 11v6M14 11v6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    library:
      '<path d="m16 6 4 14M12 6v14M8 8v12M4 4v16"/><path d="M3 20h18"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    arrowLeft: '<path d="m15 18-6-6 6-6"/>',
    arrowRight: '<path d="m9 18 6-6-6-6"/>',
    arrowUp: '<path d="m18 15-6-6-6 6"/>',
    arrowDown: '<path d="m6 9 6 6 6-6"/>',
  });

  function uiIcon(name) {
    return `<svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name]}</svg>`;
  }

  function installStaticIcons() {
    const buttons = [
      ["#csvBtn", "spreadsheet", '<span class="word">Excel</span>', "Excel"],
      ["#printBtn", "printer", '<span class="word">Друк</span>', "Друк"],
      ["#resetBtn", "trash", '<span class="word">Очистити</span>', "Очистити"],
      ["#newPostBtn", "plus", "Створити новий пост", "Створити новий пост"],
      ["#choosePostBtn", "library", "Обрати існуючий пост", "Обрати існуючий пост"],
      ["#backBtn", "arrowLeft", "Назад", "Назад"],
    ];

    buttons.forEach(([selector, icon, label, title]) => {
      const button = $(selector);
      button.innerHTML = `${uiIcon(icon)}${label}`;
      button.title = title;
      button.setAttribute("aria-label", title);
    });

    const next = $("#nextBtn");
    next.innerHTML = `Далі${uiIcon("arrowRight")}`;
    next.title = "Далі";
    next.setAttribute("aria-label", "Далі");
  }

  function toast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove("show"), 2400);
  }

  function shiftFor(point, slot) {
    return point.shiftIds?.[slot] ?? slot;
  }

  function assignedPointsForShift(shift) {
    return state.points
      .map((point, index) => (point.shiftIds.includes(shift) ? index : null))
      .filter((index) => index !== null);
  }

  function validPointsForShift(shift) {
    return state.points
      .map((point, index) => {
        const slot = point.shiftIds.indexOf(shift);
        return slot >= 0 && point.rotations[slot]?.mode !== "fixed"
          ? index
          : null;
      })
      .filter((index) => index !== null);
  }

  function normalizeShiftRule(shift) {
    while (state.shiftRules.length <= shift) {
      state.shiftRules.push(makeShiftRule());
    }

    const rule = state.shiftRules[shift] || makeShiftRule();
    rule.movement = ["team", "individual", "internal"].includes(rule.movement)
      ? rule.movement
      : "team";
    rule.routeMode = ["auto", "custom", "manual"].includes(rule.routeMode)
      ? rule.routeMode
      : "auto";
    rule.frequency = clamp(rule.frequency, 1, 31);
    rule.manualDays = rule.manualDays || {};

    const available = validPointsForShift(shift);
    const savedRoute = Array.isArray(rule.route) ? rule.route.map(Number) : [];
    rule.route = savedRoute.filter(
      (point, index) =>
        available.includes(point) && savedRoute.indexOf(point) === index,
    );
    available.forEach((point) => {
      if (!rule.route.includes(point)) rule.route.push(point);
    });

    for (let day = 0; day < state.daysCount; day += 1) {
      const selected = Number(rule.manualDays[day]);
      if (!available.includes(selected)) {
        rule.manualDays[day] = available.length
          ? available[day % available.length]
          : "";
      }
    }

    state.shiftRules[shift] = rule;
    return rule;
  }

  function normalizePoint(point) {
    const target = point && typeof point === "object" ? point : makePoint();
    const oldShiftIds = Array.isArray(target.shiftIds)
      ? target.shiftIds.map(Number)
      : (target.requirements || []).map((_, index) => index);
    const oldRotations = Array.isArray(target.rotations) ? target.rotations : [];
    const oldMemberModes = Array.isArray(target.memberModes)
      ? target.memberModes
      : [];
    target.name = target.name || "";
    target.duration = SHIFT_DURATIONS.includes(Number(target.duration))
      ? Number(target.duration)
      : 4;
    target.shiftMode =
      target.shiftMode === "simultaneous" ? "simultaneous" : "alternate";
    target.peopleRequired = clamp(
      target.peopleRequired ?? Math.max(1, ...(target.requirements || [1])),
      1,
      MAX_PEOPLE_PER_SHIFT,
    );
    target.peopleMode =
      target.peopleMode === "full" || oldMemberModes.includes("full")
        ? "full"
        : "rotate";
    target.shiftIds = oldShiftIds
      .filter(
        (shift, index) =>
          shift >= 0 &&
          shift < state.shiftsCount &&
          oldShiftIds.indexOf(shift) === index,
      )
      .sort((left, right) => left - right);
    target.requirements = target.shiftIds.map(() => target.peopleRequired);
    target.memberModes = target.shiftIds.map(() => target.peopleMode);
    target.rotations = target.shiftIds.map((shift) => {
      const oldSlot = oldShiftIds.indexOf(shift);
      return {
        mode: oldRotations[oldSlot]?.mode === "fixed" ? "fixed" : "rotate",
      };
    });
    target.closed = Array.isArray(target.closed)
      ? target.closed.filter(
          (period) =>
            Array.isArray(period) && period.length === 2 && period[0] && period[1],
        )
      : [];
    return target;
  }

  function normalize() {
    state.step = clamp(state.step, 1, 6);
    state.daysCount = clamp(state.daysCount, 1, 31);
    state.points = Array.isArray(state.points) ? state.points : [];
    state.people = Array.isArray(state.people) ? state.people : [];
    state.shiftRules = Array.isArray(state.shiftRules) ? state.shiftRules : [];
    state.postLibrary = Array.isArray(state.postLibrary) ? state.postLibrary : [];
    state.shiftTargets = state.shiftTargets || {};
    state.shiftConfirmed = state.shiftConfirmed || {};
    state.validationAttempted = state.validationAttempted || {};

    const libraryShiftCount = Math.max(
      0,
      ...state.postLibrary.flatMap((item) =>
        (item.point?.shiftIds || []).map((shift) => Number(shift) + 1),
      ),
    );
    state.shiftsCount = clamp(
      Math.max(Number(state.shiftsCount) || 0, inferShiftCount(state), libraryShiftCount),
      0,
      MAX_SHIFTS,
    );

    state.points = state.points.map(normalizePoint);
    state.pointsCount = state.points.length;
    if (state.postDraft) state.postDraft = normalizePoint(state.postDraft);
    state.postLibrary = state.postLibrary
      .filter((item) => item && item.point)
      .map((item, index) => ({
        id: Number(item.id) || index + 1,
        name: item.name || item.point.name || `Пост ${index + 1}`,
        point: normalizePoint(item.point),
      }));
    state.nextTemplateId = Math.max(
      Number(state.nextTemplateId) || 1,
      1 + Math.max(0, ...state.postLibrary.map((item) => item.id)),
    );

    const oldTargets = { ...state.shiftTargets };
    const sourcePeople = state.people.filter(
      (person) => Number(person.shift) >= 0 && Number(person.shift) < state.shiftsCount,
    );
    const roster = [];
    const nextTargets = {};
    for (let shift = 0; shift < state.shiftsCount; shift += 1) {
      const target = requiredPeopleForShift(shift);
      nextTargets[shift] = target;
      const members = sourcePeople.filter(
        (person) => Number(person.shift) === shift,
      );
      while (members.length < target) members.push(makePerson(shift, 0));
      const validPoints = assignedPointsForShift(shift);
      members.forEach((person, memberIndex) => {
        person.shift = shift;
        person.name = person.name || "";
        person.phone = person.phone || "";
        person.unit = person.unit || "";
        person.point = clamp(person.point, 0, Math.max(0, state.points.length - 1));
        if (validPoints.length && !validPoints.includes(person.point)) {
          person.point = validPoints[memberIndex % validPoints.length];
        }
        roster.push(person);
      });
      if (Number(oldTargets[shift]) !== target) {
        state.shiftConfirmed[shift] = false;
        state.validationAttempted[shift] = false;
        state.schedule = null;
      }
    }

    state.people = roster;
    state.peopleCount = roster.length;
    state.shiftTargets = nextTargets;
    state.peoplePerShift = Math.max(0, ...Object.values(nextTargets));
    state.shiftRules.length = state.shiftsCount;
    for (let shift = 0; shift < state.shiftsCount; shift += 1) {
      normalizeShiftRule(shift);
    }
    state.peopleConfirmed =
      state.shiftsCount > 0 &&
      Array.from({ length: state.shiftsCount }, (_, shift) =>
        Boolean(state.shiftConfirmed[shift]),
      ).every(Boolean);
  }

  function setPointShift(point, shift, enabled) {
    const entries = point.shiftIds.map((id, slot) => ({
      shift: Number(id),
      need: point.requirements[slot] || 1,
      memberMode: point.memberModes[slot] || "rotate",
      rotation: point.rotations[slot] || makeRotation(),
    }));
    const at = entries.findIndex((entry) => entry.shift === shift);
    if (enabled && at < 0) {
      entries.push({
        shift,
        need: point.peopleRequired || 1,
        memberMode: point.peopleMode || "rotate",
        rotation: makeRotation(),
      });
    }
    if (!enabled && at >= 0) entries.splice(at, 1);
    entries.sort((left, right) => left.shift - right.shift);
    point.shiftIds = entries.map((entry) => entry.shift);
    point.requirements = entries.map((entry) => entry.need);
    point.memberModes = entries.map((entry) => entry.memberMode);
    point.rotations = entries.map((entry) => entry.rotation);
    point.requirements = point.shiftIds.map(() => point.peopleRequired || 1);
    point.memberModes = point.shiftIds.map(() => point.peopleMode || "rotate");
  }

  function filled() {
    return state.people
      .map((person, index) => ({ ...person, index }))
      .filter((person) => person.name && person.name.trim());
  }

  function peakNeed() {
    return state.points.reduce((total, point) => {
      if (!point.requirements.length) return total;
      const pointNeed =
        point.shiftMode === "simultaneous"
          ? point.requirements.reduce((sum, need) => sum + need, 0)
          : Math.max(...point.requirements);
      return total + pointNeed;
    }, 0);
  }

  function groupPeople(pointIndex, slot) {
    const shift = shiftFor(state.points[pointIndex], slot);
    return filled().filter(
      (person) => person.point === pointIndex && person.shift === shift,
    );
  }

  function groupShortage(pointIndex, slot) {
    return Math.max(
      0,
      state.points[pointIndex].requirements[slot] -
        groupPeople(pointIndex, slot).length,
    );
  }

  function allShortages() {
    const shortages = [];
    state.points.forEach((point, pointIndex) => {
      point.requirements.forEach((_, slot) => {
        const missing = groupShortage(pointIndex, slot);
        if (missing) {
          shortages.push({
            point: pointIndex,
            shift: shiftFor(point, slot),
            slot,
            missing,
          });
        }
      });
    });
    return shortages;
  }

  function distributePeople() {
    for (let shift = 0; shift < state.shiftsCount; shift += 1) {
      const slots = [];
      state.points.forEach((point, pointIndex) => {
        const slot = point.shiftIds.indexOf(shift);
        if (slot < 0) return;
        for (let count = 0; count < point.requirements[slot]; count += 1) {
          slots.push(pointIndex);
        }
      });
      const members = state.people.filter(
        (person) => person.name && person.name.trim() && person.shift === shift,
      );
      members.forEach((person, index) => {
        if (slots.length) person.point = slots[index % slots.length];
      });
    }
    state.hybridEdited = false;
  }

  function renderProgress() {
    $("#progress").innerHTML = steps
      .map(
        (step, index) =>
          `<button data-go="${index + 1}" class="${
            state.step === index + 1
              ? "active"
              : state.step > index + 1
                ? "done"
                : ""
          }"><b>КРОК ${index + 1}</b><span>${step[0]}</span></button>`,
      )
      .join("");
    $("#title").textContent = steps[state.step - 1][0];
    $("#subtitle").textContent = steps[state.step - 1][1];
    $$(".step").forEach((element, index) => {
      element.classList.toggle("active", state.step === index + 1);
    });
    $("#backBtn").style.visibility = state.step === 1 ? "hidden" : "visible";
    $("#nextBtn").classList.toggle("hidden", state.step === 6);
  }

  function render1() {
    $("#startDate").value = state.startDate;
    $("#dayStart").value = state.dayStart;
    $("#daysCount").value = state.daysCount;
  }

  const mins = (time) => {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  };

  const clock = (value) => {
    const normalized = ((value % 1440) + 1440) % 1440;
    return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(
      normalized % 60,
    ).padStart(2, "0")}`;
  };

  function baseIntervals(point) {
    const intervals = [];
    const start = mins(state.dayStart);
    const step = point.duration * 60;
    for (let minute = 0; minute < 1440; minute += step) {
      intervals.push([clock(start + minute), clock(start + minute + step)]);
    }
    return intervals;
  }

  function requiredPeopleForShift(shift) {
    let peak = 0;
    const origin = mins(state.dayStart || "08:00");
    const relative = (time) => (mins(time) - origin + 1440) % 1440;
    for (let day = 0; day < state.daysCount; day += 1) {
      const events = [];
      state.points.forEach((point) => {
        if (!point.shiftIds.length) return;
        const intervals = activeIntervals(point);
        const dailySlots = baseIntervals(point).length;
        intervals.forEach((interval) => {
          const slots =
            point.shiftMode === "simultaneous"
              ? point.shiftIds.map((_, slot) => slot)
              : [
                  (interval.source + day * dailySlots) %
                    point.shiftIds.length,
                ];
          slots.forEach((slot) => {
            if (shiftFor(point, slot) !== shift) return;
            let start = relative(interval.start);
            let end = relative(interval.end);
            if (end <= start) end += 1440;
            const need = point.requirements[slot] || point.peopleRequired || 1;
            events.push([start, need], [end, -need]);
          });
        });
      });
      events.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
      let active = 0;
      events.forEach((event) => {
        active += event[1];
        peak = Math.max(peak, active);
      });
    }
    return peak;
  }

  function shiftColor(shift) {
    return ["#50FA7B", "#2FDEB6", "#BF9AFF", "#F6779B"][shift % 4];
  }

  function shiftLabel(shift) {
    return `Зміна ${shift + 1}`;
  }

  function plural(number, one, few, many) {
    const value = Math.abs(Number(number)) % 100;
    const last = value % 10;
    if (value > 10 && value < 20) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  function render2() {
    const draft = state.postDraft;
    $("#postChooser").innerHTML = state.choosingPost
      ? `<div class="card post-chooser-card">
          <div class="card-head"><h3>Обрати існуючий пост</h3><span class="badge">${state.postLibrary.length} збережено</span></div>
          <div class="chooser-row"><select class="control" id="postTemplateSelect">${state.postLibrary.map((item) => `<option value="${item.id}">${esc(item.name)}</option>`).join("")}</select><button class="btn primary" id="usePostTemplate">Обрати</button><button class="btn" id="cancelPostChoice">Скасувати</button></div>
        </div>`
      : "";

    if (!draft) {
      $("#postEditor").innerHTML = "";
    } else {
      const availableShifts = Array.from(
        { length: state.shiftsCount },
        (_, shift) => shift,
      ).filter((shift) => !draft.shiftIds.includes(shift));
      const selectedShifts = draft.shiftIds
        .map((shift, slot) => `<div class="draft-shift-row" style="--shift-color:${shiftColor(shift)}">
          <strong>${shiftLabel(shift)}</strong>
          <div class="seg compact"><label><input type="radio" name="draftRotation${shift}" data-draft-rotation="${slot}" value="fixed" ${draft.rotations[slot]?.mode === "fixed" ? "checked" : ""}>Постійна</label><label><input type="radio" name="draftRotation${shift}" data-draft-rotation="${slot}" value="rotate" ${draft.rotations[slot]?.mode !== "fixed" ? "checked" : ""}>Ротаційна</label></div>
          <button class="icon" data-remove-draft-shift="${shift}" title="Прибрати зміну з поста" aria-label="Прибрати зміну з поста">${uiIcon("x")}</button>
        </div>`)
        .join("");
      $("#postEditor").innerHTML = `<div class="card post-editor-card">
        <div class="card-head"><div><h3>${state.editingPoint === null ? "Новий пост" : `Редагування поста ${state.editingPoint + 1}`}</h3><div class="preview">Дата і початок доби підтягуються з Кроку 1.</div></div><span class="badge">${draft.shiftIds.length} ${plural(draft.shiftIds.length, "зміна", "зміни", "змін")}</span></div>
        <div class="inherited-period"><span><b>Дата початку:</b> ${esc(state.startDate)}</span><span><b>Початок доби:</b> ${esc(state.dayStart)}</span></div>
        <div class="post-editor-grid">
          <div class="field" data-help="Обов’язкова зрозуміла назва, наприклад «КПП» або «Кухня»."><label>Назва поста *</label><input class="control draft-point-name" value="${esc(draft.name)}" placeholder="Введіть назву поста"></div>
          <div class="field" data-help="Загальна кількість людей зі зміни, потрібних для роботи цього поста."><label>Людей для поста *</label><input class="control draft-people-required" type="number" min="1" max="${MAX_PEOPLE_PER_SHIFT}" value="${draft.peopleRequired}"></div>
          <div class="field" data-help="Тривалість одного проміжку. Доступні лише значення, на які ділиться 24."><label>Тривалість чергування</label><select class="control draft-duration">${SHIFT_DURATIONS.map((duration) => `<option value="${duration}" ${draft.duration === duration ? "selected" : ""}>${duration} год</option>`).join("")}</select></div>
        </div>
        <div class="point-config">
          <div><span class="section-label">Як зміни закривають пост</span><div class="seg"><label><input type="radio" name="draftShiftMode" data-draft-shift-mode value="alternate" ${draft.shiftMode !== "simultaneous" ? "checked" : ""}>По черзі</label><label><input type="radio" name="draftShiftMode" data-draft-shift-mode value="simultaneous" ${draft.shiftMode === "simultaneous" ? "checked" : ""}>Одночасно</label></div><div class="preview">${draft.shiftMode === "simultaneous" ? "Усі обрані зміни працюють у кожний проміжок." : "Обрані зміни послідовно змінюють одна одну."}</div></div>
          <div><span class="section-label">Як люди працюють усередині зміни</span><div class="seg"><label><input type="radio" name="draftPeopleMode" data-draft-people-mode value="rotate" ${draft.peopleMode !== "full" ? "checked" : ""}>По черзі</label><label><input type="radio" name="draftPeopleMode" data-draft-people-mode value="full" ${draft.peopleMode === "full" ? "checked" : ""}>Одночасно</label></div><div class="preview">${draft.peopleMode === "full" ? `На пост одночасно ${draft.peopleRequired === 1 ? "виходить" : "виходять"} ${draft.peopleRequired} ${plural(draft.peopleRequired, "людина", "людини", "людей")}.` : `${draft.peopleRequired} ${plural(draft.peopleRequired, "людина змінює", "людини змінюють", "людей змінюють")} одне одного по одному.`}</div></div>
        </div>
        <div class="point-shift-settings"><div class="card-head slim"><div><span class="section-label">Зміни на пості *</span><div class="preview">Оберіть уже створені зміни або створіть наступну.</div></div><span class="badge">Кількість: ${draft.shiftIds.length}</span></div><div class="draft-shift-list">${selectedShifts || '<div class="empty-state">Ще не додано жодної зміни.</div>'}</div><div class="shift-add-row">${availableShifts.length ? `<select class="control" id="availableShiftSelect">${availableShifts.map((shift) => `<option value="${shift}">${shiftLabel(shift)}</option>`).join("")}</select><button class="btn" id="addExistingShift">Додати обрану</button>` : ""}<button class="btn" id="createShiftBtn" ${state.shiftsCount >= MAX_SHIFTS ? "disabled" : ""}>${uiIcon("plus")}Створити зміну ${state.shiftsCount + 1}</button></div></div>
        <div class="point-config"><div><span class="section-label">Проміжки чергування</span><div class="preview interval-preview">${baseIntervals(draft).map((interval) => interval.join("–")).join(", ")}</div></div><div><span class="section-label">Пост не працює</span><div class="closed-list">${draft.closed.map((period, periodIndex) => `<div class="closed-row"><input class="control draft-closed-start" type="time" data-i="${periodIndex}" value="${period[0]}"><span>–</span><input class="control draft-closed-end" type="time" data-i="${periodIndex}" value="${period[1]}"><button class="icon" data-remove-draft-closed="${periodIndex}" title="Видалити час простою" aria-label="Видалити час простою">${uiIcon("x")}</button></div>`).join("") || '<div class="preview">Працює цілодобово</div>'}</div><button class="link" id="addDraftClosed">${uiIcon("plus")}Додати час простою</button></div></div>
        <div class="editor-actions"><button class="btn" id="cancelPostEdit">Скасувати</button><button class="btn primary" id="savePostBtn">Зберегти пост</button></div>
      </div>`;
    }

    const saved = state.points
      .map((point, pointIndex) => `<div class="saved-post-row">
        <div><strong>${pointIndex + 1}. ${esc(point.name)}</strong><small>${point.shiftIds.map(shiftLabel).join(", ")} · ${point.peopleRequired} ${plural(point.peopleRequired, "людина", "людини", "людей")} · ${point.duration} год · ${point.peopleMode === "full" ? "одночасно" : "по черзі"}</small></div>
        <div class="saved-post-buttons"><button class="btn" data-edit-post="${pointIndex}">Редагувати</button><button class="btn" data-duplicate-post="${pointIndex}">Дублювати</button><button class="icon" data-delete-post="${pointIndex}" title="Видалити пост" aria-label="Видалити пост">${uiIcon("trash")}</button></div>
      </div>`)
      .join("");
    const savedActions = state.lastSavedPoint !== null && state.points[state.lastSavedPoint]
      ? `<div class="post-saved-actions"><span><b>Пост «${esc(state.points[state.lastSavedPoint].name)}» збережено.</b></span><div><button class="btn" data-duplicate-post="${state.lastSavedPoint}">Дублювати пост</button><button class="btn" id="newPostAfterSave">${uiIcon("plus")}Створити новий</button><button class="btn primary" data-step-next>Далі${uiIcon("arrowRight")}</button></div></div>`
      : "";
    $("#pointsList").innerHTML = `${savedActions}<div class="saved-posts-head"><h3>Пости поточного графіка</h3><span class="badge">${state.points.length}</span></div>${saved || '<div class="empty-state">Пости ще не створені. Натисніть «Створити новий пост».</div>'}`;
  }

  function render3() {
    const completeCount = state.people.filter(
      (person) => person.name.trim() && person.unit.trim() && person.phone.trim(),
    ).length;
    const calculatedTotal = Array.from(
      { length: state.shiftsCount },
      (_, shift) => Number(state.shiftTargets[shift]) || 0,
    ).reduce((sum, need) => sum + need, 0);
    $("#rosterTotal").innerHTML = `Створено змін: <b>${state.shiftsCount}</b>. Розраховано людей: <b>${calculatedTotal}</b>.`;
    $("#peopleNeed").innerHTML = `Рядків у списку: <b>${state.people.length}</b>. Повністю заповнено: <b>${completeCount}</b>.`;

    let groups = "";
    for (let shift = 0; shift < state.shiftsCount; shift += 1) {
      const target = Number(state.shiftTargets[shift]) || 0;
      const members = state.people
        .map((person, index) => ({ ...person, index }))
        .filter((person) => person.shift === shift);
      const completed = members.filter(
        (person) => person.name.trim() && person.unit.trim() && person.phone.trim(),
      ).length;
      const attempted = Boolean(state.validationAttempted[shift]);
      const confirmed = Boolean(state.shiftConfirmed[shift]);
      groups += `<div class="card shift-card" style="--shift-color:${shiftColor(shift)}">
        <div class="card-head"><div><h3>${shiftLabel(shift)}</h3><div class="preview">Потрібно за параметрами постів: ${target}. Додаткові люди вважаються резервом.</div></div><span class="badge shift-status">${confirmed ? "✓ Підтверджено" : `${completed} з ${target} заповнено`}</span></div>
        ${members
          .map(
            (person, memberIndex) => {
              const requiredRow = memberIndex < target;
              const hasAny = Boolean(
                person.name.trim() || person.unit.trim() || person.phone.trim(),
              );
              const showMissing = attempted && (requiredRow || hasAny);
              return `<div class="person-row ${requiredRow ? "required-person" : "reserve-person"}">
                <div class="num">${memberIndex + 1}</div>
                <div class="field unit" data-help="Вкажіть підрозділ, звідки прибула людина."><label>Підрозділ *</label><input class="control person-unit ${showMissing && !person.unit.trim() ? "invalid" : ""}" data-i="${person.index}" data-shift="${shift}" value="${esc(person.unit)}" placeholder="Наприклад: 2 рота"></div>
                <div class="field" data-help="Вкажіть прізвище та ініціали, наприклад «Коваль І. П.»."><label>Прізвище та ініціали *</label><input class="control person-name ${showMissing && !person.name.trim() ? "invalid" : ""}" data-i="${person.index}" data-shift="${shift}" value="${esc(person.name)}" placeholder="Прізвище І. П."></div>
                <div class="field phone" data-help="Контактний номер чергового. Дозволені цифри, пробіли, дужки, + і дефіс."><label>Телефон *</label><input class="control person-phone ${showMissing && !person.phone.trim() ? "invalid" : ""}" data-i="${person.index}" data-shift="${shift}" value="${esc(person.phone)}" placeholder="+380 00 000 00 00"></div>
                <button class="icon remove-person" data-remove-person="${person.index}" title="${requiredRow ? "Цей рядок створено за розрахованою потребою" : "Видалити додаткову людину"}" aria-label="${requiredRow ? "Обов'язковий рядок" : "Видалити додаткову людину"}" ${requiredRow ? "disabled" : ""}>${uiIcon("x")}</button>
              </div>`;
            },
          )
          .join("")}
        <div class="shift-card-actions"><button class="btn" data-add-person="${shift}">${uiIcon("plus")}Додати людину</button><button class="btn primary" data-confirm-shift="${shift}">Підтвердити зміну</button></div>
      </div>`;
    }
    $("#peopleList").innerHTML = groups || '<div class="empty-state">На Кроці 2 ще не створено жодної зміни.</div>';

    const rosterShortages = Array.from(
      { length: state.shiftsCount },
      (_, shift) => {
        const target = Number(state.shiftTargets[shift]) || 0;
        const completed = state.people.filter(
          (person) =>
            person.shift === shift &&
            person.name.trim() &&
            person.unit.trim() &&
            person.phone.trim(),
        ).length;
        return { shift, missing: Math.max(0, target - completed) };
      },
    ).filter((item) => item.missing);
    $("#peopleWarning").innerHTML = rosterShortages.some(
      (item) => state.shiftConfirmed[item.shift],
    )
      ? `<div class="warning neon">${rosterShortages.map((item) => `${shiftLabel(item.shift)}: не вистачає ${item.missing} людей. У графіку буде створено ${item.missing === 1 ? "позначення" : "позначення"} «Черговий N».`).join("<br>")}</div>`
      : "";
    $("#peopleConfirmText").className = state.peopleConfirmed
      ? "confirmed"
      : "";
    $("#peopleConfirmText").textContent = state.peopleConfirmed
      ? "✓ Усі зміни підтверджено"
      : "Підтвердьте кожну зміну або всі зміни однією кнопкою";
  }

  function pointOptionsFor(person) {
    const valid = assignedPointsForShift(person.shift);
    if (valid.length && !valid.includes(person.point)) person.point = valid[0];
    return valid
      .map(
        (pointIndex) =>
          `<option value="${pointIndex}" ${person.point === pointIndex ? "selected" : ""}>${esc(state.points[pointIndex].name || `Пост ${pointIndex + 1}`)}</option>`,
      )
      .join("");
  }

  function render4() {
    $$("[data-assignment-mode]").forEach((element) => {
      element.checked = element.value === state.assignmentMode;
    });
    $("#autoAssignBtn").classList.toggle(
      "hidden",
      state.assignmentMode === "manual",
    );

    const showManual = ["manual", "hybrid"].includes(state.assignmentMode);
    $("#manualAssignments").innerHTML = showManual
      ? filled()
          .map(
            (person) =>
              `<div class="manual-row shift-accent-row" style="--shift-color:${shiftColor(person.shift)}">
                <div class="num">${person.index + 1}</div>
                <div class="manual-shift">Зміна ${person.shift + 1}</div>
                <div class="field"><label>Черговий</label><div class="control" style="display:flex;align-items:center">${esc(person.name)}</div></div>
                <div class="field"><label>Початковий пост</label><select class="control manual-point" data-i="${person.index}">${pointOptionsFor(person)}</select></div>
              </div>`,
          )
          .join("")
      : "";

    const shortages = allShortages();
    $("#coverageWarning").innerHTML = shortages.length
      ? `<div class="warning neon">Є незакриті місця: ${shortages.reduce((sum, shortage) => sum + shortage.missing, 0)}</div>`
      : '<div class="total"><b>Початкове призначення укомплектоване.</b></div>';

    let coverage = "";
    state.points.forEach((point, pointIndex) => {
      point.requirements.forEach((need, slot) => {
        const people = groupPeople(pointIndex, slot);
        const missing = Math.max(0, need - people.length);
        const shift = shiftFor(point, slot);
        coverage += `<div class="coverage-card shift-accent-row ${missing ? "short" : ""}" style="--shift-color:${shiftColor(shift)}">
          <b>${esc(point.name)} · ${shiftLabel(shift).toLowerCase()}</b>
          <small>Потрібно ${need} · призначено ${people.length} · ${point.memberModes[slot] === "full" ? "повним складом" : "люди по черзі"}</small>
          <div class="names">${people.map((person) => esc(person.name)).join("<br>") || "Немає призначених"}${missing ? `<br><span class="placeholder">Не вистачає: ${missing}</span>` : ""}</div>
        </div>`;
      });
    });
    $("#coverage").innerHTML = coverage;
  }

  function dateAt(index) {
    const date = new Date(`${state.startDate}T12:00:00`);
    date.setDate(date.getDate() + index);
    return date;
  }

  function dayLabel(index) {
    return new Intl.DateTimeFormat("uk-UA", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
    }).format(dateAt(index));
  }

  function routeName(pointIndex) {
    return state.points[pointIndex]?.name || `Пост ${pointIndex + 1}`;
  }

  function render5() {
    let html =
      '<div class="total"><b>Постійні призначення залишаються на своєму пості. Для решти можна задати рівень ротації, частоту, маршрут або ручний пост на кожний день.</b></div>';

    for (let shift = 0; shift < state.shiftsCount; shift += 1) {
      const rule = normalizeShiftRule(shift);
      const assigned = assignedPointsForShift(shift);
      const rotatable = validPointsForShift(shift);
      const route = rule.route.filter((point) => rotatable.includes(point));
      const routeOrder = (rule.routeMode === "custom" ? route : rotatable)
        .map((point) => esc(routeName(point)))
        .join(" → ");

      const customRoute = route
        .map(
          (point, index) =>
            `<div class="route-row">
              <strong>${index + 1}. ${esc(routeName(point))}</strong>
              <div class="route-actions">
                <button class="icon" data-route-shift="${shift}" data-route-point="${point}" data-route-delta="-1" title="Перемістити вище" aria-label="Перемістити вище" ${index === 0 ? "disabled" : ""}>${uiIcon("arrowUp")}</button>
                <button class="icon" data-route-shift="${shift}" data-route-point="${point}" data-route-delta="1" title="Перемістити нижче" aria-label="Перемістити нижче" ${index === route.length - 1 ? "disabled" : ""}>${uiIcon("arrowDown")}</button>
              </div>
            </div>`,
        )
        .join("");

      const manualDays = Array.from({ length: state.daysCount }, (_, day) => {
        const selected = String(rule.manualDays[day] ?? "");
        return `<div class="manual-day">
          <label>День ${day + 1} · ${dayLabel(day)}</label>
          <select class="control manual-day-point" data-shift="${shift}" data-day="${day}">
            ${rotatable.map((point) => `<option value="${point}" ${selected === String(point) ? "selected" : ""}>${esc(routeName(point))}</option>`).join("")}
          </select>
        </div>`;
      }).join("");

      const postRules = assigned
        .map((pointIndex) => {
          const slot = state.points[pointIndex].shiftIds.indexOf(shift);
          const rotation = state.points[pointIndex].rotations[slot];
          return `<div class="post-rule-row">
            <strong>${esc(routeName(pointIndex))}</strong>
            <div class="seg">
              <label><input type="radio" name="postRule${shift}-${pointIndex}" data-mode="${pointIndex}:${slot}" value="fixed" ${rotation.mode === "fixed" ? "checked" : ""}>Постійна</label>
              <label><input type="radio" name="postRule${shift}-${pointIndex}" data-mode="${pointIndex}:${slot}" value="rotate" ${rotation.mode !== "fixed" ? "checked" : ""}>Ротаційна</label>
            </div>
          </div>`;
        })
        .join("");

      html += `<div class="card shift-card" style="--shift-color:${shiftColor(shift)};margin-top:12px">
        <div class="card-head"><h3>Зміна ${shift + 1}</h3><span class="badge">${assigned.length} постів</span></div>
        <div class="shift-rule-grid">
          <div class="rule-section">
            <span class="section-label">Що переходить між постами</span>
            <div class="seg three">
              <label><input type="radio" name="movement${shift}" data-movement="${shift}" value="team" ${rule.movement === "team" ? "checked" : ""}>Уся зміна</label>
              <label><input type="radio" name="movement${shift}" data-movement="${shift}" value="individual" ${rule.movement === "individual" ? "checked" : ""}>Окремі люди</label>
              <label><input type="radio" name="movement${shift}" data-movement="${shift}" value="internal" ${rule.movement === "internal" ? "checked" : ""}>Лише всередині</label>
            </div>
            <div class="rule-note">${
              rule.movement === "team"
                ? "Усі групи зміни переходять синхронно, зберігаючи розподіл між постами."
                : rule.movement === "individual"
                  ? "Люди переходять зі зміщенням і можуть опинятися на різних постах."
                  : "Люди не переходять між постами, але міняються всередині своїх чергувань."
            }</div>

            <div class="field" style="margin-top:12px">
              <label>Порядок переходу</label>
              <select class="control shift-route-mode" data-shift="${shift}" ${rule.movement === "internal" ? "disabled" : ""}>
                <option value="auto" ${rule.routeMode === "auto" ? "selected" : ""}>Автоматично на наступний пост</option>
                <option value="custom" ${rule.routeMode === "custom" ? "selected" : ""}>Власний маршрут</option>
                <option value="manual" ${rule.routeMode === "manual" ? "selected" : ""}>Вручну по днях</option>
              </select>
            </div>
            ${
              rule.movement !== "internal" && rule.routeMode !== "manual"
                ? `<div class="field" style="margin-top:10px"><label>Перехід кожні, днів</label><input class="control shift-frequency" data-shift="${shift}" type="number" min="1" max="31" value="${rule.frequency}"></div>`
                : ""
            }
            ${rule.movement !== "internal" && rule.routeMode === "custom" ? `<div class="route-list">${customRoute || '<div class="preview">Немає ротаційних постів.</div>'}</div>` : ""}
            ${rule.movement !== "internal" && rule.routeMode === "manual" ? `<div class="manual-days">${manualDays || '<div class="preview">Немає ротаційних постів.</div>'}</div>` : ""}
            ${rule.movement !== "internal" && rule.routeMode !== "manual" ? `<div class="preview"><b>Маршрут:</b> ${routeOrder || "немає ротаційних постів"}</div>` : ""}
          </div>
          <div class="rule-section">
            <span class="section-label">Правило на кожному пості</span>
            <div class="post-rule-list">${postRules || '<div class="preview">Зміна не призначена на пости.</div>'}</div>
          </div>
        </div>
      </div>`;
    }

    $("#rotationList").innerHTML = html;
  }

  function configurationErrors() {
    const errors = [];
    if (!state.startDate) errors.push("Не обрано перший день графіка.");
    state.points.forEach((point, index) => {
      if (!point.name.trim()) errors.push(`Пост ${index + 1} не має назви.`);
      if (!point.shiftIds.length) {
        errors.push(`${point.name || `Пост ${index + 1}`} не має призначеної зміни.`);
      }
    });
    return errors;
  }

  function configurationWarnings() {
    const warnings = [];
    for (let shift = 0; shift < state.shiftsCount; shift += 1) {
      const target = Number(state.shiftTargets[shift]) || 0;
      const named = state.people.filter(
        (person) =>
          person.shift === shift &&
          person.name.trim() &&
          person.unit.trim() &&
          person.phone.trim(),
      ).length;
      if (named < target) {
        warnings.push(
          `${shiftLabel(shift)}: заповнено ${named} із ${target} людей.`,
        );
      }
    }
    state.points.forEach((point, index) => {
      if (!activeIntervals(point).length) {
        warnings.push(`${point.name || `Пост ${index + 1}`} не має робочих проміжків.`);
      }
    });
    return warnings;
  }

  function render6() {
    const errors = configurationErrors();
    const warnings = configurationWarnings();
    const shortages = allShortages();

    $("#review").innerHTML = `<div class="review-line"><b>Період:</b> ${state.startDate}, ${state.daysCount} днів, доба з ${state.dayStart}</div>
      <div class="review-line"><b>Пости:</b> ${state.points
        .map(
          (point) =>
            `${esc(point.name)} — ${point.requirements.length} змін (${point.requirements.map((need, slot) => `зм. ${shiftFor(point, slot) + 1}: ${need}, ${point.memberModes[slot] === "full" ? "повним складом" : "по черзі"}`).join("; ")}), ${point.shiftMode === "simultaneous" ? "одночасно" : "по черзі"}`,
        )
        .join("; ")}</div>
      ${errors.length ? `<div class="warning neon"><b>Потрібно виправити:</b><br>${errors.map(esc).join("<br>")}</div>` : '<div class="review-line status-ok"><b>Критичних помилок немає.</b></div>'}
      ${warnings.length ? `<div class="warning"><b>Попередження:</b><br>${warnings.map(esc).join("<br>")}</div>` : ""}
      ${
        shortages.length
          ? `<div class="warning neon">${shortages
              .map(
                (shortage) =>
                  `${esc(state.points[shortage.point].name)}, зміна ${shortage.shift + 1}: не вистачає ${shortage.missing}`,
              )
              .join("<br>")}</div>
             <div class="review-line build-choice"><b>Як заповнити нестачу?</b><div class="seg" style="margin-top:9px">
               <label><input type="radio" name="shortage" data-shortage value="placeholders" ${state.shortageMode !== "redistribute" ? "checked" : ""}>Додати «Черговий N»</label>
               <label><input type="radio" name="shortage" data-shortage value="redistribute" ${state.shortageMode === "redistribute" ? "checked" : ""}>Перебудувати наявними</label>
             </div></div>`
          : ""
      }`;
    $("#buildBtn").disabled = errors.length > 0;
    if (state.schedule) renderSchedule();
  }

  function render() {
    normalize();
    renderProgress();
    render1();
    if (state.step === 2) render2();
    if (state.step === 3) render3();
    if (state.step === 4) render4();
    if (state.step === 5) render5();
    if (state.step === 6) render6();
    save();
  }

  function read() {
    if ($("#startDate")) {
      state.startDate = $("#startDate").value;
      state.dayStart = $("#dayStart").value;
      state.daysCount = clamp($("#daysCount").value, 1, 31);
    }
    if (state.postDraft) {
      const name = $(".draft-point-name");
      const duration = $(".draft-duration");
      const peopleRequired = $(".draft-people-required");
      if (name) state.postDraft.name = name.value.trim();
      if (duration) state.postDraft.duration = Number(duration.value);
      if (peopleRequired) {
        state.postDraft.peopleRequired = clamp(
          peopleRequired.value,
          1,
          MAX_PEOPLE_PER_SHIFT,
        );
        state.postDraft.requirements = state.postDraft.shiftIds.map(
          () => state.postDraft.peopleRequired,
        );
      }
      $$(".draft-closed-start").forEach((element) => {
        state.postDraft.closed[element.dataset.i][0] = element.value;
      });
      $$(".draft-closed-end").forEach((element) => {
        state.postDraft.closed[element.dataset.i][1] = element.value;
      });
    }
    $$(".person-name").forEach((element) => {
      state.people[element.dataset.i].name = element.value.trim();
    });
    $$(".person-phone").forEach((element) => {
      state.people[element.dataset.i].phone = element.value.trim();
    });
    $$(".person-unit").forEach((element) => {
      state.people[element.dataset.i].unit = element.value.trim();
    });
    save();
  }

  function validNext() {
    read();
    if (state.step === 1 && !state.startDate) return "Оберіть перший день.";
    if (state.step === 2 && state.postDraft) {
      return "Збережіть або скасуйте редагування поста.";
    }
    if (state.step === 2 && !state.points.length) {
      return "Створіть щонайменше один пост.";
    }
    if (state.step === 2 && state.points.some((point) => !point.name.trim())) {
      return "Заповніть назви постів.";
    }
    if (state.step === 2 && state.points.some((point) => !point.shiftIds.length)) {
      return "Призначте щонайменше одну зміну на кожний пост.";
    }
    if (state.step === 3 && !state.peopleConfirmed) {
      return "Підтвердьте список людей.";
    }
    return "";
  }

  function activeIntervals(point) {
    const origin = mins(state.dayStart);
    const relative = (time) => (mins(time) - origin + 1440) % 1440;
    const output = [];

    baseIntervals(point).forEach((interval, source) => {
      let start = relative(interval[0]);
      let end = relative(interval[1]);
      if (end <= start) end += 1440;
      let segments = [[start, end]];

      point.closed.forEach((closed) => {
        let closedStart = relative(closed[0]);
        let closedEnd = relative(closed[1]);
        if (closedEnd <= closedStart) closedEnd += 1440;
        [
          [closedStart, closedEnd],
          [closedStart - 1440, closedEnd - 1440],
          [closedStart + 1440, closedEnd + 1440],
        ].forEach(([cutStart, cutEnd]) => {
          const next = [];
          segments.forEach(([segmentStart, segmentEnd]) => {
            if (cutEnd <= segmentStart || cutStart >= segmentEnd) {
              next.push([segmentStart, segmentEnd]);
            } else {
              if (cutStart > segmentStart) next.push([segmentStart, cutStart]);
              if (cutEnd < segmentEnd) next.push([cutEnd, segmentEnd]);
            }
          });
          segments = next;
        });
      });

      segments.forEach(([segmentStart, segmentEnd]) => {
        if (segmentEnd > segmentStart) {
          output.push({
            start: clock(segmentStart + origin),
            end: clock(segmentEnd + origin),
            source,
          });
        }
      });
    });
    return output;
  }

  function scheduleIntervals(point) {
    const intervals = activeIntervals(point);
    if (point.shiftMode === "simultaneous") {
      return intervals.flatMap((interval) =>
        point.requirements.map((_, shift) => ({ ...interval, shift })),
      );
    }
    return intervals.map((interval) => ({
      ...interval,
      shift: interval.source % point.requirements.length,
    }));
  }

  function rotationAtInitialPoint(person) {
    const point = state.points[person.point];
    if (!point) return null;
    const slot = point.shiftIds.indexOf(person.shift);
    return slot >= 0 ? point.rotations[slot] : null;
  }

  function currentPointForPerson(person, day) {
    const initial = person.point;
    const rotation = rotationAtInitialPoint(person);
    if (rotation?.mode === "fixed") return initial;

    const rule = normalizeShiftRule(person.shift);
    if (rule.movement === "internal") return initial;

    const available = validPointsForShift(person.shift);
    if (!available.length) return initial;

    if (rule.routeMode === "manual") {
      const target = Number(rule.manualDays[day]);
      return available.includes(target) ? target : initial;
    }

    const route =
      rule.routeMode === "custom"
        ? rule.route.filter((point) => available.includes(point))
        : available;
    if (!route.length) return initial;

    const initialAt = route.indexOf(initial);
    const base = initialAt >= 0 ? initialAt : 0;
    let advance = Math.floor(day / rule.frequency);
    if (rule.movement === "individual") advance += person.shiftPosition || 0;
    return route[(base + advance) % route.length];
  }

  function choosePeople(candidates, need, memberMode, seed) {
    if (!candidates.length || need <= 0) return [];
    if (memberMode === "full") return candidates.slice(0, need);
    const start = seed % candidates.length;
    const chosen = [];
    for (let offset = 0; offset < Math.min(need, candidates.length); offset += 1) {
      chosen.push(candidates[(start + offset) % candidates.length]);
    }
    return chosen;
  }

  function build() {
    read();
    normalize();
    const errors = configurationErrors();
    if (errors.length) {
      toast(errors[0]);
      return;
    }

    const shortages = allShortages();
    if (shortages.length) {
      const action =
        state.shortageMode === "redistribute"
          ? "Наявні люди будуть повторно використані; одночасні призначення підсвітяться."
          : "Будуть додані тимчасові «Черговий N».";
      const message = `${shortages
        .map(
          (shortage) =>
            `${state.points[shortage.point].name}, зміна ${shortage.shift + 1}: не вистачає ${shortage.missing}`,
        )
        .join("\n")}\n\n${action}\n\nПродовжити?`;
      if (!confirm(message)) return;
    }

    const positions = {};
    const realPeople = filled().map((person) => {
      const shiftPosition = positions[person.shift] || 0;
      positions[person.shift] = shiftPosition + 1;
      return {
        ...person,
        id: `p${person.index}`,
        placeholder: false,
        shiftPosition,
      };
    });

    const rows = [];
    state.points.forEach((point, pointIndex) => {
      scheduleIntervals(point).forEach((interval) => {
        const dailySlots = baseIntervals(point).length;
        const row = {
          point: pointIndex,
          shift: shiftFor(point, interval.shift),
          need:
            point.memberModes[interval.shift] === "full"
              ? point.requirements[interval.shift]
              : 1,
          start: interval.start,
          end: interval.end,
          shifts: [],
          needs: [],
          cells: [],
          conflict: Array(state.daysCount).fill(false),
        };

        for (let day = 0; day < state.daysCount; day += 1) {
          const slot =
            point.shiftMode === "simultaneous"
              ? interval.shift
              : (interval.source + day * dailySlots) % point.requirements.length;
          const shift = shiftFor(point, slot);
          const memberMode = point.memberModes[slot] || "rotate";
          const need =
            memberMode === "full" ? point.requirements[slot] : 1;
          row.shifts.push(shift);
          row.needs.push(need);

          const candidates = realPeople.filter(
            (person) =>
              person.shift === shift &&
              currentPointForPerson(person, day) === pointIndex,
          );
          const chosen = choosePeople(
            candidates,
            need,
            memberMode,
            day * dailySlots + interval.source,
          );

          let placeholderNumber = 1;
          while (chosen.length < need) {
            if (state.shortageMode === "redistribute" && realPeople.length) {
              const sameShift = realPeople.filter(
                (person) => person.shift === shift,
              );
              const pool = sameShift.length ? sameShift : realPeople;
              chosen.push(
                pool[(pointIndex + day + chosen.length) % pool.length],
              );
            } else {
              chosen.push({
                name: `Черговий ${placeholderNumber} · ${shiftLabel(shift)}`,
                phone: "не вказано",
                unit: "",
                id: `x${pointIndex}-${shift}-${day}-${interval.source}-${placeholderNumber}`,
                placeholder: true,
              });
              placeholderNumber += 1;
            }
          }
          row.cells.push(chosen);
        }
        rows.push(row);
      });
    });

    const schedule = { rows, conflicts: 0 };
    const origin = mins(state.dayStart);
    const span = (row) => {
      let start = (mins(row.start) - origin + 1440) % 1440;
      let end = (mins(row.end) - origin + 1440) % 1440;
      if (end <= start) end += 1440;
      return [start, end];
    };

    for (let day = 0; day < state.daysCount; day += 1) {
      for (let left = 0; left < rows.length; left += 1) {
        for (let right = left + 1; right < rows.length; right += 1) {
          const first = rows[left];
          const second = rows[right];
          if (first.point === second.point) continue;
          const [firstStart, firstEnd] = span(first);
          const [secondStart, secondEnd] = span(second);
          if (!(firstStart < secondEnd && secondStart < firstEnd)) continue;
          const ids = first.cells[day]
            .filter((person) => !person.placeholder)
            .map((person) => person.id);
          const samePerson = second.cells[day].some((person) =>
            ids.includes(person.id),
          );
          if (samePerson) {
            if (!first.conflict[day]) schedule.conflicts += 1;
            if (!second.conflict[day]) schedule.conflicts += 1;
            first.conflict[day] = true;
            second.conflict[day] = true;
          }
        }
      }
    }

    state.schedule = schedule;
    save();
    renderSchedule();
    toast(
      schedule.conflicts
        ? `Готово: ${schedule.conflicts} конфліктів`
        : "Графік сформовано",
    );
  }

  function renderSchedule() {
    let html =
      '<thead><tr><th>Пост / час</th>' +
      Array.from(
        { length: state.daysCount },
        (_, day) =>
          `<th>День ${day + 1}<br><small>${dayLabel(day)}</small></th>`,
      ).join("") +
      "</tr></thead><tbody>";

    state.schedule.rows.forEach((row) => {
      const shifts = row.shifts || row.cells.map(() => row.shift);
      const unique = [...new Set(shifts)];
      const shiftSummary =
        unique.length === 1 ? `зміна ${unique[0] + 1}` : "зміни по днях";
      html += `<tr><td class="slot"><b>${esc(state.points[row.point].name)}</b><small>${row.start}–${row.end} · ${shiftSummary}</small></td>${row.cells
        .map(
          (people, day) => {
            const shift = shifts[day] ?? row.shift;
            return `<td class="schedule-shift-cell ${row.conflict[day] || people.some((person) => person.placeholder) ? "neon" : ""}" style="--shift-color:${shiftColor(shift)}">
              <span class="day-shift">${shiftLabel(shift)}</span>
              ${people.map((person) => `<span class="person-chip ${person.placeholder ? "placeholder" : ""}">${esc(person.name)}<br><small>${esc(person.unit || "без підрозділу")}</small></span>`).join("")}
              ${row.conflict[day] ? '<span class="conflict">Одночасне призначення</span>' : ""}
            </td>`;
          },
        )
        .join("")}</tr>`;
    });

    $("#scheduleTable").innerHTML = `${html}</tbody>`;
    $("#tableWrap").classList.remove("hidden");
  }

  function printSchedule() {
    if (!state.schedule) {
      toast("Спочатку сформуйте графік");
      return;
    }
    const printUrl = new URL(location.href);
    printUrl.search = "?print=1";
    const printWindow = window.open(printUrl.toString(), "_blank");
    if (!printWindow) location.href = printUrl.toString();
  }

  function initPrintPage() {
    if (new URLSearchParams(location.search).get("print") !== "1") return;
    if (!state.schedule) {
      location.href = location.pathname;
      return;
    }
    state.step = 6;
    render();
    document.body.classList.add("print-page");
    const toolbar = document.createElement("div");
    toolbar.className = "print-toolbar";
    toolbar.innerHTML = `<button class="btn primary" id="printNowBtn">${uiIcon("printer")}Друк</button><button class="btn" id="closePrintBtn">${uiIcon("x")}Закрити</button>`;
    document.body.prepend(toolbar);
    toolbar.querySelector("#printNowBtn").onclick = () => window.print();
    toolbar.querySelector("#closePrintBtn").onclick = () => {
      if (history.length > 1) history.back();
      else window.close();
    };
  }

  function xmlText(value) {
    return String(value ?? "").replace(
      /[&<>]/g,
      (character) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character],
    );
  }

  function xlsxColumn(index) {
    let name = "";
    for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) {
      name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    }
    return name;
  }

  function xlsxSheet(rows) {
    const body = rows
      .map(
        (row, rowIndex) =>
          `<row r="${rowIndex + 1}">${row
            .map(
              (value, columnIndex) =>
                `<c r="${xlsxColumn(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`,
            )
            .join("")}</row>`,
      )
      .join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="22" customWidth="1"/><col min="3" max="5" width="12" customWidth="1"/><col min="6" max="6" width="24" customWidth="1"/><col min="7" max="7" width="20" customWidth="1"/><col min="8" max="8" width="18" customWidth="1"/></cols><sheetData>${body}</sheetData></worksheet>`;
  }

  const zipU16 = (number) => new Uint8Array([number & 255, (number >>> 8) & 255]);
  const zipU32 = (number) =>
    new Uint8Array([
      number & 255,
      (number >>> 8) & 255,
      (number >>> 16) & 255,
      (number >>> 24) & 255,
    ]);

  function zipJoin(parts) {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(size);
    let at = 0;
    parts.forEach((part) => {
      output.set(part, at);
      at += part.length;
    });
    return output;
  }

  let crcTable;
  function zipCrc(data) {
    if (!crcTable) {
      crcTable = Array.from({ length: 256 }, (_, number) => {
        let code = number;
        for (let bit = 0; bit < 8; bit += 1) {
          code = code & 1 ? 0xedb88320 ^ (code >>> 1) : code >>> 1;
        }
        return code >>> 0;
      });
    }
    let crc = 0xffffffff;
    for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function makeXlsx(entries) {
    const encoder = new TextEncoder();
    const now = new Date();
    const time =
      (now.getHours() << 11) |
      (now.getMinutes() << 5) |
      (now.getSeconds() >> 1);
    const date =
      ((now.getFullYear() - 1980) << 9) |
      ((now.getMonth() + 1) << 5) |
      now.getDate();
    const local = [];
    const central = [];
    let offset = 0;

    entries.forEach(([name, text]) => {
      const nameBytes = encoder.encode(name);
      const data = encoder.encode(text);
      const crc = zipCrc(data);
      const header = zipJoin([
        zipU32(0x04034b50),
        zipU16(20),
        zipU16(0x800),
        zipU16(0),
        zipU16(time),
        zipU16(date),
        zipU32(crc),
        zipU32(data.length),
        zipU32(data.length),
        zipU16(nameBytes.length),
        zipU16(0),
        nameBytes,
      ]);
      const record = zipJoin([header, data]);
      local.push(record);
      central.push(
        zipJoin([
          zipU32(0x02014b50),
          zipU16(20),
          zipU16(20),
          zipU16(0x800),
          zipU16(0),
          zipU16(time),
          zipU16(date),
          zipU32(crc),
          zipU32(data.length),
          zipU32(data.length),
          zipU16(nameBytes.length),
          zipU16(0),
          zipU16(0),
          zipU16(0),
          zipU16(0),
          zipU32(0),
          zipU32(offset),
          nameBytes,
        ]),
      );
      offset += record.length;
    });

    const directory = zipJoin(central);
    const end = zipJoin([
      zipU32(0x06054b50),
      zipU16(0),
      zipU16(0),
      zipU16(entries.length),
      zipU16(entries.length),
      zipU32(directory.length),
      zipU32(offset),
      zipU16(0),
    ]);
    return new Blob([...local, directory, end], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  async function excel() {
    if (!state.schedule) {
      toast("Спочатку сформуйте графік");
      return;
    }
    const rows = [
      ["Дата", "Пост", "Початок", "Кінець", "Зміна", "Черговий", "Підрозділ", "Телефон"],
    ];
    state.schedule.rows.forEach((row) => {
      row.cells.forEach((people, day) => {
        people.forEach((person) => {
          rows.push([
            dateAt(day).toLocaleDateString("uk-UA"),
            state.points[row.point].name,
            row.start,
            row.end,
            (row.shifts?.[day] ?? row.shift) + 1,
            person.name,
            person.unit || "",
            person.phone || "",
          ]);
        });
      });
    });

    const entries = [
      [
        "[Content_Types].xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      ],
      [
        "_rels/.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ],
      [
        "xl/workbook.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Графік" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ],
      [
        "xl/_rels/workbook.xml.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ],
      ["xl/worksheets/sheet1.xml", xlsxSheet(rows)],
    ];
    const blob = makeXlsx(entries);
    const filename = `grafik-cherguvan-${state.startDate}.xlsx`;

    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 5000);
    toast("Excel-файл створено. Перевірте завантаження");
  }

  function invalidatePeopleSetup() {
    state.peopleConfirmed = false;
    for (let shift = 0; shift < state.shiftsCount; shift += 1) {
      state.shiftConfirmed[shift] = false;
      state.validationAttempted[shift] = false;
    }
    state.schedule = null;
  }

  function openPostDraft(point = null, editingPoint = null, clearName = false) {
    state.postDraft = clone(point || makePoint(state.points.length, 0));
    if (clearName) state.postDraft.name = "";
    state.editingPoint = editingPoint;
    state.choosingPost = false;
    state.lastSavedPoint = null;
    normalizePoint(state.postDraft);
    render2();
    save();
  }

  function savePostDraft() {
    read();
    const draft = state.postDraft;
    if (!draft) return;
    const nameInput = $(".draft-point-name");
    if (!draft.name.trim()) {
      nameInput?.classList.add("invalid");
      toast("Вкажіть назву поста.");
      return;
    }
    if (!draft.shiftIds.length) {
      toast("Додайте щонайменше одну зміну на пост.");
      return;
    }
    const duplicateName = state.points.some(
      (point, index) =>
        index !== state.editingPoint &&
        point.name.trim().toLocaleLowerCase("uk-UA") ===
          draft.name.trim().toLocaleLowerCase("uk-UA"),
    );
    if (duplicateName) {
      nameInput?.classList.add("invalid");
      toast("Пост із такою назвою вже додано до графіка.");
      return;
    }

    const savedPoint = normalizePoint(clone(draft));
    let savedIndex;
    if (state.editingPoint === null) {
      state.points.push(savedPoint);
      savedIndex = state.points.length - 1;
    } else {
      savedIndex = state.editingPoint;
      state.points[savedIndex] = savedPoint;
    }
    const template = state.postLibrary.find(
      (item) =>
        item.name.trim().toLocaleLowerCase("uk-UA") ===
        savedPoint.name.trim().toLocaleLowerCase("uk-UA"),
    );
    if (template) {
      template.name = savedPoint.name;
      template.point = clone(savedPoint);
    } else {
      state.postLibrary.push({
        id: state.nextTemplateId,
        name: savedPoint.name,
        point: clone(savedPoint),
      });
      state.nextTemplateId += 1;
    }
    state.postDraft = null;
    state.editingPoint = null;
    state.lastSavedPoint = savedIndex;
    state.pointsCount = state.points.length;
    invalidatePeopleSetup();
    normalize();
    render2();
    save();
    toast("Пост збережено");
  }

  function personIsComplete(person) {
    return Boolean(
      person.name.trim() && person.unit.trim() && person.phone.trim(),
    );
  }

  function personIsPartial(person) {
    const any = person.name.trim() || person.unit.trim() || person.phone.trim();
    return Boolean(any && !personIsComplete(person));
  }

  function confirmOneShift(shift, askAboutShortage = true) {
    read();
    state.validationAttempted[shift] = true;
    const members = state.people.filter((person) => person.shift === shift);
    if (members.some(personIsPartial)) {
      state.shiftConfirmed[shift] = false;
      state.peopleConfirmed = false;
      render3();
      save();
      toast(`${shiftLabel(shift)}: заповніть або очистьте неповні рядки.`);
      return false;
    }
    const target = Number(state.shiftTargets[shift]) || 0;
    const completed = members.filter(personIsComplete).length;
    const missing = Math.max(0, target - completed);
    if (
      missing &&
      askAboutShortage &&
      !confirm(
        `${shiftLabel(shift)}: потрібно ${target}, заповнено ${completed}. Не вистачає ${missing} людей.\n\nГрафік буде створено з наявним складом, а порожні місця отримають позначення «Черговий N · ${shiftLabel(shift)}».\n\nПідтвердити зміну?`,
      )
    ) {
      render3();
      save();
      return false;
    }
    state.shiftConfirmed[shift] = true;
    state.peopleConfirmed = Array.from(
      { length: state.shiftsCount },
      (_, index) => Boolean(state.shiftConfirmed[index]),
    ).every(Boolean);
    render3();
    save();
    toast(missing ? `${shiftLabel(shift)} підтверджено з нестачею` : `${shiftLabel(shift)} підтверджено`);
    return true;
  }

  function confirmAllShifts() {
    read();
    const partial = [];
    const shortages = [];
    for (let shift = 0; shift < state.shiftsCount; shift += 1) {
      state.validationAttempted[shift] = true;
      const members = state.people.filter((person) => person.shift === shift);
      if (members.some(personIsPartial)) partial.push(shift);
      const target = Number(state.shiftTargets[shift]) || 0;
      const completed = members.filter(personIsComplete).length;
      if (completed < target) shortages.push({ shift, missing: target - completed });
    }
    if (partial.length) {
      partial.forEach((shift) => { state.shiftConfirmed[shift] = false; });
      state.peopleConfirmed = false;
      render3();
      save();
      toast("Заповніть або очистьте неповні рядки, підсвічені червоним.");
      return;
    }
    if (
      shortages.length &&
      !confirm(
        `${shortages.map((item) => `${shiftLabel(item.shift)}: не вистачає ${item.missing}`).join("\n")}\n\nГрафік буде сформовано з наявним складом. Для порожніх місць буде створено «Черговий N».\n\nПідтвердити всі зміни?`,
      )
    ) {
      render3();
      save();
      return;
    }
    for (let shift = 0; shift < state.shiftsCount; shift += 1) {
      state.shiftConfirmed[shift] = true;
    }
    state.peopleConfirmed = state.shiftsCount > 0;
    render3();
    save();
    toast(shortages.length ? "Усі зміни підтверджено з нестачею" : "Усі зміни підтверджено");
  }

  document.addEventListener("click", (event) => {
    const main = event.target.closest("[data-main]");
    if (main) {
      read();
      state.daysCount = clamp(
        state.daysCount + Number(main.dataset.delta),
        1,
        31,
      );
      state.schedule = null;
      normalize();
      render();
      return;
    }

    if (event.target.closest("#newPostBtn,#newPostAfterSave")) {
      openPostDraft();
      return;
    }

    if (event.target.closest("#choosePostBtn")) {
      if (!state.postLibrary.length) {
        toast("Ще немає збережених постів для вибору.");
        return;
      }
      state.choosingPost = true;
      state.postDraft = null;
      state.editingPoint = null;
      state.lastSavedPoint = null;
      render2();
      save();
      return;
    }

    if (event.target.closest("#cancelPostChoice")) {
      state.choosingPost = false;
      render2();
      save();
      return;
    }

    if (event.target.closest("#usePostTemplate")) {
      const id = Number($("#postTemplateSelect")?.value);
      const template = state.postLibrary.find((item) => item.id === id);
      if (template) openPostDraft(template.point);
      return;
    }

    if (event.target.closest("#cancelPostEdit")) {
      state.postDraft = null;
      state.editingPoint = null;
      render2();
      save();
      return;
    }

    if (event.target.closest("#savePostBtn")) {
      savePostDraft();
      return;
    }

    if (event.target.closest("#createShiftBtn")) {
      read();
      if (!state.postDraft || state.shiftsCount >= MAX_SHIFTS) return;
      const shift = state.shiftsCount;
      state.shiftsCount += 1;
      state.shiftRules.push(makeShiftRule());
      setPointShift(state.postDraft, shift, true);
      state.postDraft = normalizePoint(state.postDraft);
      render2();
      save();
      toast(`${shiftLabel(shift)} створено`);
      return;
    }

    if (event.target.closest("#addExistingShift")) {
      read();
      const shift = Number($("#availableShiftSelect")?.value);
      if (state.postDraft && Number.isInteger(shift)) {
        setPointShift(state.postDraft, shift, true);
        state.postDraft = normalizePoint(state.postDraft);
        render2();
        save();
      }
      return;
    }

    const removeDraftShift = event.target.closest("[data-remove-draft-shift]");
    if (removeDraftShift) {
      read();
      setPointShift(
        state.postDraft,
        Number(removeDraftShift.dataset.removeDraftShift),
        false,
      );
      state.postDraft = normalizePoint(state.postDraft);
      render2();
      save();
      return;
    }

    if (event.target.closest("#addDraftClosed")) {
      read();
      state.postDraft?.closed.push(["22:00", "06:00"]);
      render2();
      save();
      return;
    }

    const removeDraftClosed = event.target.closest("[data-remove-draft-closed]");
    if (removeDraftClosed) {
      read();
      state.postDraft?.closed.splice(
        Number(removeDraftClosed.dataset.removeDraftClosed),
        1,
      );
      render2();
      save();
      return;
    }

    const editPost = event.target.closest("[data-edit-post]");
    if (editPost) {
      const pointIndex = Number(editPost.dataset.editPost);
      openPostDraft(state.points[pointIndex], pointIndex);
      return;
    }

    const duplicatePost = event.target.closest("[data-duplicate-post]");
    if (duplicatePost) {
      openPostDraft(
        state.points[Number(duplicatePost.dataset.duplicatePost)],
        null,
        true,
      );
      return;
    }

    const deletePost = event.target.closest("[data-delete-post]");
    if (deletePost) {
      const pointIndex = Number(deletePost.dataset.deletePost);
      if (!confirm(`Видалити пост «${state.points[pointIndex].name}» із графіка?`)) return;
      state.points.splice(pointIndex, 1);
      state.people.forEach((person) => {
        if (person.point > pointIndex) person.point -= 1;
        else if (person.point === pointIndex) person.point = 0;
      });
      state.lastSavedPoint = null;
      invalidatePeopleSetup();
      normalize();
      render2();
      save();
      return;
    }

    const addPerson = event.target.closest("[data-add-person]");
    if (addPerson) {
      const shift = Number(addPerson.dataset.addPerson);
      state.people.push(makePerson(shift, assignedPointsForShift(shift)[0] || 0));
      state.shiftConfirmed[shift] = false;
      state.peopleConfirmed = false;
      render3();
      save();
      return;
    }

    const removePerson = event.target.closest("[data-remove-person]");
    if (removePerson && !removePerson.disabled) {
      const personIndex = Number(removePerson.dataset.removePerson);
      const shift = state.people[personIndex]?.shift;
      state.people.splice(personIndex, 1);
      state.shiftConfirmed[shift] = false;
      state.peopleConfirmed = false;
      render3();
      save();
      return;
    }

    const confirmShift = event.target.closest("[data-confirm-shift]");
    if (confirmShift) {
      confirmOneShift(Number(confirmShift.dataset.confirmShift));
      return;
    }

    if (event.target.closest("[data-step-next]")) {
      $("#nextBtn").click();
      return;
    }

    const routeMove = event.target.closest("[data-route-delta]");
    if (routeMove) {
      const shift = Number(routeMove.dataset.routeShift);
      const point = Number(routeMove.dataset.routePoint);
      const delta = Number(routeMove.dataset.routeDelta);
      const route = state.shiftRules[shift].route;
      const at = route.indexOf(point);
      const target = at + delta;
      if (at >= 0 && target >= 0 && target < route.length) {
        [route[at], route[target]] = [route[target], route[at]];
        state.schedule = null;
        render5();
        save();
      }
      return;
    }

    const go = event.target.closest("[data-go]");
    if (go && Number(go.dataset.go) <= state.step) {
      state.step = Number(go.dataset.go);
      render();
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.matches(".person-name,.person-phone,.person-unit")) {
      const shift = Number(event.target.dataset.shift);
      state.shiftConfirmed[shift] = false;
      state.peopleConfirmed = false;
      state.schedule = null;
      if (event.target.value.trim()) event.target.classList.remove("invalid");
    }
    if (event.target.matches(".draft-point-name") && event.target.value.trim()) {
      event.target.classList.remove("invalid");
    }
    read();
    save();
  });

  document.addEventListener("change", (event) => {
    const target = event.target;

    if (target.matches("#daysCount")) {
      read();
      normalize();
      state.schedule = null;
      render();
      return;
    }

    if (target.matches("[data-draft-shift-mode]")) {
      read();
      state.postDraft.shiftMode = target.value;
      render2();
      save();
      return;
    }

    if (target.matches("[data-draft-people-mode]")) {
      read();
      state.postDraft.peopleMode = target.value;
      state.postDraft.memberModes = state.postDraft.shiftIds.map(
        () => target.value,
      );
      render2();
      save();
      return;
    }

    if (target.matches("[data-draft-rotation]")) {
      read();
      const slot = Number(target.dataset.draftRotation);
      state.postDraft.rotations[slot] = { mode: target.value };
      render2();
      save();
      return;
    }

    if (target.matches(".draft-duration,.draft-people-required")) {
      read();
      render2();
      save();
      return;
    }

    if (target.matches("[data-assignment-mode]")) {
      state.assignmentMode = target.value;
      if (["auto", "hybrid"].includes(state.assignmentMode)) distributePeople();
      state.schedule = null;
      render4();
      save();
      return;
    }

    if (target.matches(".manual-point")) {
      state.people[target.dataset.i].point = Number(target.value);
      if (state.assignmentMode === "hybrid") state.hybridEdited = true;
      state.schedule = null;
      render4();
      save();
      return;
    }

    if (target.matches("[data-mode]")) {
      const [point, slot] = target.dataset.mode.split(":").map(Number);
      state.points[point].rotations[slot].mode = target.value;
      const shift = shiftFor(state.points[point], slot);
      normalizeShiftRule(shift);
      state.schedule = null;
      render5();
      save();
      return;
    }

    if (target.matches("[data-movement]")) {
      const shift = Number(target.dataset.movement);
      state.shiftRules[shift].movement = target.value;
      state.schedule = null;
      render5();
      save();
      return;
    }

    if (target.matches(".shift-route-mode")) {
      const shift = Number(target.dataset.shift);
      state.shiftRules[shift].routeMode = target.value;
      normalizeShiftRule(shift);
      state.schedule = null;
      render5();
      save();
      return;
    }

    if (target.matches(".shift-frequency")) {
      const shift = Number(target.dataset.shift);
      state.shiftRules[shift].frequency = clamp(target.value, 1, 31);
      state.schedule = null;
      render5();
      save();
      return;
    }

    if (target.matches(".manual-day-point")) {
      const shift = Number(target.dataset.shift);
      state.shiftRules[shift].manualDays[target.dataset.day] = Number(
        target.value,
      );
      state.schedule = null;
      save();
      return;
    }

    if (target.matches("[data-shortage]")) {
      state.shortageMode = target.value;
      state.schedule = null;
      save();
      return;
    }

    if (
      target.matches(
        ".draft-closed-start,.draft-closed-end,#dayStart,#startDate",
      )
    ) {
      state.schedule = null;
    }
    read();
    if (target.matches("#dayStart,#startDate")) normalize();
    save();
  });

  $("#autoAssignBtn").onclick = () => {
    distributePeople();
    state.schedule = null;
    render4();
    save();
    toast("Розподіл перераховано");
  };

  $("#confirmPeople").onclick = confirmAllShifts;

  $("#nextBtn").onclick = () => {
    const error = validNext();
    if (error) {
      toast(error);
      return;
    }
    state.step = Math.min(6, state.step + 1);
    render();
  };

  $("#backBtn").onclick = () => {
    read();
    state.step = Math.max(1, state.step - 1);
    render();
  };

  $("#buildBtn").onclick = build;
  $("#csvBtn").onclick = excel;
  $("#printBtn").onclick = printSchedule;
  $("#resetBtn").onclick = () => {
    if (!confirm("Очистити дані майстра?")) return;
    localStorage.removeItem(KEY);
    localStorage.removeItem(PREVIOUS_KEY);
    localStorage.removeItem(LEGACY_KEY);
    state = clone(defaults);
    state.startDate = today();
    render();
  };

  installStaticIcons();
  if (!state.startDate) state.startDate = today();
  normalize();
  render();
  initPrintPage();
})();

