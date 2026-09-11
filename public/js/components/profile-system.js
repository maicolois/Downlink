const PROFILES_STORAGE_KEY = 'downlink.profiles.v1';
const ACTIVE_PROFILE_STORAGE_KEY = 'downlink.activeProfileId.v1';
const MAX_PROFILES = 5;
const MAX_NAME_LENGTH = 24;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const AVATAR_SIZE = 256;
const DEFAULT_AVATAR = 'ember';
const PRESET_AVATAR_IMAGES = Object.freeze({
  ember: '/assets/avatars/ember-fox.webp',
  ocean: '/assets/avatars/ocean-otter.webp',
  violet: '/assets/avatars/violet-robot.webp',
  forest: '/assets/avatars/forest-frog.webp',
  sunset: '/assets/avatars/sunset-cat.webp',
});
const PRESET_AVATARS = new Set(Object.keys(PRESET_AVATAR_IMAGES));
const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const STORED_PHOTO_PATTERN = /^data:image\/(?:jpeg|webp);base64,/i;
const instances = new WeakMap();

function normalizeName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeAvatar(value) {
  if (value && value.type === 'preset' && PRESET_AVATARS.has(value.value)) {
    return { type: 'preset', value: value.value };
  }
  if (value && value.type === 'image' && typeof value.value === 'string'
      && value.value.length <= 1_500_000 && STORED_PHOTO_PATTERN.test(value.value)) {
    return { type: 'image', value: value.value };
  }
  return { type: 'preset', value: DEFAULT_AVATAR };
}

function normalizeProfile(value, knownIds) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string') return null;
  const id = value.id.trim();
  const name = normalizeName(value.name);
  if (!id || id.length > 128 || knownIds.has(id) || !name || name.length > MAX_NAME_LENGTH) return null;
  knownIds.add(id);
  const now = Date.now();
  return {
    id,
    name,
    avatar: normalizeAvatar(value.avatar),
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : now,
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : now,
  };
}

function isQuotaError(error) {
  return error?.name === 'QuotaExceededError'
    || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || error?.code === 22
    || error?.code === 1014;
}

function createProfileId(existingProfiles) {
  const knownIds = new Set(existingProfiles.map(profile => profile.id));
  let id;
  do {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      id = globalThis.crypto.randomUUID();
    } else {
      id = `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
  } while (knownIds.has(id));
  return id;
}

function profileInitial(name) {
  return Array.from(normalizeName(name))[0]?.toLocaleUpperCase('es') || 'D';
}

function getAvatarContainer(image, initial) {
  return image?.closest('.profile-avatar') || initial?.closest('.profile-avatar') || image?.parentElement || null;
}

function paintAvatar({ container, image, initial }, avatar, name) {
  const normalizedAvatar = normalizeAvatar(avatar);
  const isCustomImage = normalizedAvatar.type === 'image';
  const imageSource = isCustomImage
    ? normalizedAvatar.value
    : PRESET_AVATAR_IMAGES[normalizedAvatar.value];
  const avatarName = isCustomImage ? 'custom' : normalizedAvatar.value;
  if (container) {
    container.dataset.avatar = avatarName;
    container.classList.toggle('has-image', Boolean(imageSource));
  }
  if (image) {
    if (imageSource) image.src = imageSource;
    else image.removeAttribute('src');
    image.hidden = !imageSource;
    image.alt = '';
  }
  if (initial) {
    initial.textContent = profileInitial(name);
    initial.hidden = Boolean(imageSource);
  }
}

async function decodePhoto(file) {
  if (typeof window.createImageBitmap === 'function') {
    let bitmap;
    try {
      bitmap = await window.createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      try {
        bitmap = await window.createImageBitmap(file);
      } catch {
        bitmap = null;
      }
    }
    if (bitmap) {
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close?.(),
      };
    }
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release: () => URL.revokeObjectURL(objectUrl),
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('No se pudo leer la imagen.'));
    };
    image.src = objectUrl;
  });
}

async function cropPhoto(file) {
  const decoded = await decodePhoto(file);
  try {
    if (!decoded.width || !decoded.height) throw new Error('La imagen no tiene un tamaño válido.');
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('El navegador no puede preparar esta imagen.');

    const sourceSize = Math.min(decoded.width, decoded.height);
    const sourceX = (decoded.width - sourceSize) / 2;
    const sourceY = (decoded.height - sourceSize) / 2;
    context.fillStyle = '#151515';
    context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
    context.drawImage(
      decoded.source,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      AVATAR_SIZE,
      AVATAR_SIZE,
    );

    let dataUrl = canvas.toDataURL('image/webp', 0.86);
    if (!dataUrl.startsWith('data:image/webp')) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    }
    if (!STORED_PHOTO_PATTERN.test(dataUrl)) {
      throw new Error('El navegador no puede guardar esta imagen en un formato compatible.');
    }
    return dataUrl;
  } finally {
    decoded.release();
  }
}

export function initializeProfileSystem() {
  const profileGate = document.getElementById('profileGate');
  if (instances.has(profileGate)) return instances.get(profileGate);

  const elements = {
    profileGate,
    chooserView: document.getElementById('profileChooserView'),
    editorView: document.getElementById('profileEditorView'),
    profileList: document.getElementById('profileList'),
    addButton: document.getElementById('profileAddButton'),
    editorForm: document.getElementById('profileEditorForm'),
    editorTitle: document.getElementById('profileEditorTitle'),
    nameInput: document.getElementById('profileNameInput'),
    avatarPreview: document.getElementById('profileAvatarPreview'),
    avatarImage: document.getElementById('profileAvatarImage'),
    avatarInitial: document.getElementById('profileAvatarInitial'),
    avatarEditButton: document.getElementById('profileAvatarEditButton'),
    presetList: document.getElementById('profilePresetList'),
    photoInput: document.getElementById('profilePhotoInput'),
    photoButton: document.getElementById('profilePhotoButton'),
    photoRemove: document.getElementById('profilePhotoRemove'),
    editorBack: document.getElementById('profileEditorBack'),
    editorCancel: document.getElementById('profileEditorCancel'),
    deleteButton: document.getElementById('profileDeleteButton'),
    editorStatus: document.getElementById('profileEditorStatus'),
    profileControl: document.getElementById('profileControl'),
    menuButton: document.getElementById('profileMenuButton'),
    profileMenu: document.getElementById('profileMenu'),
    menuAvatarImage: document.getElementById('profileMenuAvatarImage'),
    menuAvatarInitial: document.getElementById('profileMenuAvatarInitial'),
    menuIdentityImage: document.getElementById('profileMenuIdentityImage'),
    menuIdentityInitial: document.getElementById('profileMenuIdentityInitial'),
    menuName: document.getElementById('profileMenuName'),
    switchButton: document.getElementById('profileSwitchButton'),
    editButton: document.getElementById('profileEditButton'),
    signOutButton: document.getElementById('profileSignOutButton'),
  };

  const optionalElements = new Set(['editorStatus', 'menuIdentityImage', 'menuIdentityInitial']);
  const missingElement = Object.entries(elements)
    .find(([name, element]) => !element && !optionalElements.has(name));
  if (missingElement) throw new Error(`No se puede iniciar el sistema de perfiles: falta #${missingElement[0]}.`);

  let storage = null;
  let storageIsUnavailable = false;
  try {
    storage = window.localStorage;
    storage.getItem(PROFILES_STORAGE_KEY);
  } catch {
    storage = null;
    storageIsUnavailable = true;
  }

  function removeStoredValue(key) {
    if (!storage) return;
    try {
      storage.removeItem(key);
    } catch {
      storage = null;
      storageIsUnavailable = true;
    }
  }

  function readProfiles() {
    if (!storage) return [];
    let raw;
    try {
      raw = storage.getItem(PROFILES_STORAGE_KEY);
    } catch {
      storage = null;
      storageIsUnavailable = true;
      return [];
    }
    if (!raw) return [];

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      removeStoredValue(PROFILES_STORAGE_KEY);
      removeStoredValue(ACTIVE_PROFILE_STORAGE_KEY);
      return [];
    }
    if (!Array.isArray(parsed)) {
      removeStoredValue(PROFILES_STORAGE_KEY);
      removeStoredValue(ACTIVE_PROFILE_STORAGE_KEY);
      return [];
    }

    const knownIds = new Set();
    const validProfiles = parsed
      .map(value => normalizeProfile(value, knownIds))
      .filter(Boolean)
      .slice(0, MAX_PROFILES);
    if (validProfiles.length !== parsed.length) {
      try {
        storage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(validProfiles));
      } catch {
        // The valid in-memory copy remains usable if corrupted storage cannot be repaired.
      }
    }
    return validProfiles;
  }

  function readActiveProfileId(availableProfiles) {
    if (!storage) return null;
    let id;
    try {
      id = storage.getItem(ACTIVE_PROFILE_STORAGE_KEY);
    } catch {
      storage = null;
      storageIsUnavailable = true;
      return null;
    }
    if (!id) return null;
    if (availableProfiles.some(profile => profile.id === id)) return id;
    removeStoredValue(ACTIVE_PROFILE_STORAGE_KEY);
    return null;
  }

  function saveProfiles(nextProfiles) {
    if (!storage) return { ok: true, persistent: false };
    try {
      storage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(nextProfiles));
      return { ok: true, persistent: true };
    } catch (error) {
      if (isQuotaError(error)) return { ok: false, quota: true };
      storage = null;
      storageIsUnavailable = true;
      return { ok: true, persistent: false };
    }
  }

  function saveActiveProfileId(id) {
    if (!storage) return;
    try {
      if (id) storage.setItem(ACTIVE_PROFILE_STORAGE_KEY, id);
      else storage.removeItem(ACTIVE_PROFILE_STORAGE_KEY);
    } catch {
      storage = null;
      storageIsUnavailable = true;
    }
  }

  let profiles = readProfiles();
  let activeProfileId = readActiveProfileId(profiles);
  let currentView = 'chooser';
  let editorOrigin = 'chooser';
  let editingProfileId = null;
  let draftAvatar = { type: 'preset', value: DEFAULT_AVATAR };
  let draftPreset = DEFAULT_AVATAR;
  let menuOpen = false;
  let photoBusy = false;
  let photoRevision = 0;
  let gateReturnFocus = null;
  let destroyed = false;

  const saveButton = elements.editorForm.querySelector('[type="submit"]');
  const menuItems = Array.from(elements.profileMenu.querySelectorAll('[role="menuitem"]'));

  function focusableMenuItems() {
    return menuItems.filter(item => !item.disabled && !item.hidden && item.getAttribute('aria-hidden') !== 'true');
  }

  function activeProfile() {
    return profiles.find(profile => profile.id === activeProfileId) || null;
  }

  function focusElement(element) {
    if (element instanceof HTMLElement && element.isConnected && !element.hidden && !element.hasAttribute('disabled')) {
      element.focus({ preventScroll: true });
    }
  }

  function setEditorStatus(message = '', kind = 'status') {
    if (!elements.editorStatus) return;
    elements.editorStatus.textContent = message;
    elements.editorStatus.hidden = !message;
    elements.editorStatus.dataset.kind = message ? kind : '';
    elements.editorStatus.classList.toggle('is-error', Boolean(message) && kind !== 'status');
    elements.editorStatus.setAttribute('role', kind === 'status' ? 'status' : 'alert');
    elements.editorStatus.setAttribute('aria-live', kind === 'status' ? 'polite' : 'assertive');
  }

  function setNameError(message = '') {
    elements.nameInput.setCustomValidity(message);
    elements.nameInput.setAttribute('aria-invalid', String(Boolean(message)));
    setEditorStatus(message, 'name');
  }

  function renderDraftAvatar() {
    const name = elements.nameInput.value;
    paintAvatar(
      { container: elements.avatarPreview, image: elements.avatarImage, initial: elements.avatarInitial },
      draftAvatar,
      name,
    );
    elements.photoRemove.hidden = draftAvatar.type !== 'image';
    for (const button of elements.presetList.querySelectorAll('button[data-avatar]')) {
      const selected = draftAvatar.type === 'preset' && button.dataset.avatar === draftAvatar.value;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
      const initial = button.querySelector('.profile-avatar__initial');
      if (initial) initial.textContent = profileInitial(name);
    }
  }

  function createProfileCard(profile) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'profile-card';
    card.dataset.profileId = profile.id;
    card.setAttribute('aria-label', `Entrar como ${profile.name}`);

    const avatar = document.createElement('span');
    avatar.className = 'profile-card__avatar profile-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    const image = document.createElement('img');
    image.className = 'profile-card__image profile-avatar__image';
    image.alt = '';
    const initial = document.createElement('span');
    initial.className = 'profile-card__initial profile-avatar__initial';
    avatar.append(image, initial);
    paintAvatar({ container: avatar, image, initial }, profile.avatar, profile.name);

    const name = document.createElement('span');
    name.className = 'profile-card__name';
    name.textContent = profile.name;
    card.append(avatar, name);
    return card;
  }

  function renderProfileList() {
    const fragment = document.createDocumentFragment();
    profiles.forEach(profile => fragment.append(createProfileCard(profile)));
    elements.profileList.replaceChildren(fragment);
    const atLimit = profiles.length >= MAX_PROFILES;
    elements.addButton.disabled = atLimit;
    elements.addButton.hidden = atLimit;
    elements.addButton.setAttribute('aria-hidden', String(atLimit));
  }

  function closeMenu({ restoreFocus = false } = {}) {
    if (!menuOpen) return;
    menuOpen = false;
    elements.profileMenu.classList.remove('is-open');
    elements.profileControl.classList.remove('is-open');
    elements.profileMenu.hidden = true;
    elements.menuButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus) focusElement(elements.menuButton);
  }

  function openMenu({ focus = false, last = false } = {}) {
    if (!activeProfile()) return;
    const availableItems = focusableMenuItems();
    if (menuOpen) {
      if (focus) focusElement(last ? availableItems.at(-1) : availableItems[0]);
      return;
    }
    menuOpen = true;
    elements.profileMenu.hidden = false;
    elements.profileMenu.classList.add('is-open');
    elements.profileControl.classList.add('is-open');
    elements.menuButton.setAttribute('aria-expanded', 'true');
    if (focus) focusElement(last ? availableItems.at(-1) : availableItems[0]);
  }

  function renderActiveProfile() {
    const profile = activeProfile();
    elements.profileControl.hidden = !profile;
    elements.profileControl.classList.toggle('is-active', Boolean(profile));
    if (!profile) {
      closeMenu();
      return;
    }

    paintAvatar(
      {
        container: getAvatarContainer(elements.menuAvatarImage, elements.menuAvatarInitial),
        image: elements.menuAvatarImage,
        initial: elements.menuAvatarInitial,
      },
      profile.avatar,
      profile.name,
    );
    paintAvatar(
      {
        container: getAvatarContainer(elements.menuIdentityImage, elements.menuIdentityInitial),
        image: elements.menuIdentityImage,
        initial: elements.menuIdentityInitial,
      },
      profile.avatar,
      profile.name,
    );
    elements.menuName.textContent = profile.name;
    elements.menuButton.setAttribute('aria-label', `Abrir menú del perfil ${profile.name}`);
  }

  function setView(view) {
    currentView = view;
    const chooserActive = view === 'chooser';
    elements.profileGate.setAttribute('aria-labelledby', chooserActive ? 'profileGateTitle' : 'profileEditorTitle');
    elements.chooserView.hidden = !chooserActive;
    elements.chooserView.classList.toggle('is-active', chooserActive);
    elements.editorView.hidden = chooserActive;
    elements.editorView.classList.toggle('is-active', !chooserActive);
  }

  function gateIsOpen() {
    return elements.profileGate.open || elements.profileGate.hasAttribute('open');
  }

  function focusCurrentView() {
    if (!gateIsOpen()) return;
    if (currentView === 'editor') {
      focusElement(elements.nameInput);
      return;
    }
    focusElement(elements.profileList.querySelector('.profile-card') || elements.addButton);
  }

  function openGate({ returnFocus = document.activeElement } = {}) {
    closeMenu();
    if (!gateIsOpen()) {
      gateReturnFocus = returnFocus;
      elements.profileGate.hidden = false;
      elements.profileGate.classList.add('is-open');
      if (typeof elements.profileGate.showModal === 'function') elements.profileGate.showModal();
      else elements.profileGate.setAttribute('open', '');
    }
    queueMicrotask(focusCurrentView);
  }

  function restoreGateFocus() {
    const preferred = gateReturnFocus === elements.menuButton || !gateReturnFocus?.isConnected
      ? elements.menuButton
      : gateReturnFocus;
    gateReturnFocus = null;
    focusElement(preferred);
  }

  function closeGate() {
    if (!activeProfile()) return false;
    photoRevision += 1;
    setPhotoBusy(false);
    elements.profileGate.classList.remove('is-open');
    if (gateIsOpen() && typeof elements.profileGate.close === 'function') {
      elements.profileGate.close();
    } else {
      elements.profileGate.removeAttribute('open');
      elements.profileGate.hidden = true;
      restoreGateFocus();
    }
    return true;
  }

  function showChooser({ focus = true } = {}) {
    photoRevision += 1;
    setPhotoBusy(false);
    editingProfileId = null;
    editorOrigin = 'chooser';
    setEditorStatus();
    setView('chooser');
    renderProfileList();
    if (focus) queueMicrotask(focusCurrentView);
  }

  function showEditor(profile = null, { origin = 'chooser', focus = true } = {}) {
    photoRevision += 1;
    setPhotoBusy(false);
    const isEditing = Boolean(profile);
    editingProfileId = profile?.id || null;
    editorOrigin = origin;
    elements.editorForm.reset();
    elements.photoInput.value = '';
    elements.nameInput.value = profile?.name || '';
    elements.nameInput.setCustomValidity('');
    elements.nameInput.setAttribute('aria-invalid', 'false');
    draftAvatar = normalizeAvatar(profile?.avatar);
    draftPreset = draftAvatar.type === 'preset' ? draftAvatar.value : DEFAULT_AVATAR;
    elements.editorView.classList.toggle('is-editing', isEditing);
    elements.editorView.classList.toggle('is-creating', !isEditing);
    elements.avatarEditButton.hidden = false;
    elements.avatarEditButton.setAttribute(
      'aria-label',
      isEditing ? `Cambiar foto del perfil ${profile.name}` : 'Añadir una foto al perfil',
    );
    elements.editorTitle.textContent = isEditing ? 'Editar perfil' : 'Crear perfil';
    if (saveButton) saveButton.textContent = isEditing ? 'Guardar cambios' : 'Crear perfil';
    elements.deleteButton.hidden = !isEditing;
    const canLeave = Boolean(activeProfile()) || profiles.length > 0;
    elements.editorBack.hidden = isEditing || !canLeave;
    elements.editorCancel.hidden = !canLeave;
    setEditorStatus(storageIsUnavailable
      ? 'El navegador bloquea el almacenamiento local. El perfil solo durará durante esta sesión.'
      : '');
    setView('editor');
    renderDraftAvatar();
    if (focus) queueMicrotask(focusCurrentView);
  }

  function leaveEditor() {
    if (editorOrigin === 'menu' && activeProfile()) {
      closeGate();
    } else if (profiles.length > 0) {
      showChooser();
    } else {
      setEditorStatus('Crea un perfil para poder entrar en Downlink.', 'name');
      focusElement(elements.nameInput);
    }
  }

  function setPhotoBusy(value) {
    photoBusy = Boolean(value);
    elements.photoButton.disabled = photoBusy;
    elements.avatarEditButton.disabled = photoBusy;
    elements.photoInput.disabled = photoBusy;
    elements.photoRemove.disabled = photoBusy;
    if (saveButton) saveButton.disabled = photoBusy;
    elements.avatarPreview.setAttribute('aria-busy', String(photoBusy));
  }

  function commitProfiles(nextProfiles) {
    const result = saveProfiles(nextProfiles);
    if (!result.ok) {
      setEditorStatus(
        result.quota
          ? 'No queda espacio para guardar el perfil. Prueba a quitar la foto o elimina otro perfil.'
          : 'No se pudo guardar el perfil en este navegador.',
        'storage',
      );
      return false;
    }
    profiles = nextProfiles;
    if (!result.persistent) storageIsUnavailable = true;
    return true;
  }

  function activateProfile(id) {
    if (!profiles.some(profile => profile.id === id)) return;
    activeProfileId = id;
    saveActiveProfileId(id);
    renderActiveProfile();
    gateReturnFocus = elements.menuButton;
    closeGate();
  }

  function deleteEditingProfile() {
    const profile = profiles.find(candidate => candidate.id === editingProfileId);
    if (!profile) return;
    if (!window.confirm(`¿Eliminar el perfil “${profile.name}”? Esta acción no se puede deshacer.`)) return;
    const nextProfiles = profiles.filter(candidate => candidate.id !== profile.id);
    if (!commitProfiles(nextProfiles)) return;
    if (activeProfileId === profile.id) {
      activeProfileId = null;
      saveActiveProfileId(null);
    }
    renderActiveProfile();
    if (profiles.length > 0) showChooser();
    else showEditor(null, { origin: 'initial' });
  }

  function submitEditor(event) {
    event.preventDefault();
    if (photoBusy) {
      setEditorStatus('Espera a que termine de prepararse la foto.', 'photo');
      return;
    }

    const name = normalizeName(elements.nameInput.value);
    if (!name) {
      setNameError('Escribe un nombre para el perfil.');
      focusElement(elements.nameInput);
      return;
    }
    if (name.length > MAX_NAME_LENGTH) {
      setNameError(`El nombre puede tener como máximo ${MAX_NAME_LENGTH} caracteres.`);
      focusElement(elements.nameInput);
      return;
    }
    setNameError();

    const now = Date.now();
    let savedId = editingProfileId;
    let nextProfiles;
    if (editingProfileId) {
      const existingProfile = profiles.find(profile => profile.id === editingProfileId);
      if (!existingProfile) {
        showChooser();
        return;
      }
      nextProfiles = profiles.map(profile => profile.id === editingProfileId
        ? { ...profile, name, avatar: normalizeAvatar(draftAvatar), updatedAt: now }
        : profile);
    } else {
      if (profiles.length >= MAX_PROFILES) {
        setEditorStatus(`Puedes crear un máximo de ${MAX_PROFILES} perfiles.`, 'storage');
        return;
      }
      savedId = createProfileId(profiles);
      nextProfiles = [
        ...profiles,
        { id: savedId, name, avatar: normalizeAvatar(draftAvatar), createdAt: now, updatedAt: now },
      ];
    }

    if (!commitProfiles(nextProfiles)) return;
    activeProfileId = savedId;
    saveActiveProfileId(savedId);
    renderProfileList();
    renderActiveProfile();
    gateReturnFocus = elements.menuButton;
    closeGate();
  }

  async function selectPhoto(file) {
    const revision = ++photoRevision;
    if (!file) return;
    if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
      setEditorStatus('Elige una imagen PNG, JPG o WebP.', 'photo');
      elements.photoInput.value = '';
      return;
    }
    if (!file.size || file.size > MAX_PHOTO_BYTES) {
      setEditorStatus('La foto debe ocupar 5 MB o menos.', 'photo');
      elements.photoInput.value = '';
      return;
    }

    setPhotoBusy(true);
    setEditorStatus('Preparando foto…');
    try {
      const dataUrl = await cropPhoto(file);
      if (destroyed || revision !== photoRevision || currentView !== 'editor') return;
      draftAvatar = { type: 'image', value: dataUrl };
      renderDraftAvatar();
      setEditorStatus();
    } catch (error) {
      if (destroyed || revision !== photoRevision) return;
      setEditorStatus(error?.message || 'No se pudo preparar la foto.', 'photo');
    } finally {
      if (revision === photoRevision) {
        elements.photoInput.value = '';
        setPhotoBusy(false);
      }
    }
  }

  function handleDocumentPointerDown(event) {
    if (menuOpen && !elements.profileControl.contains(event.target)) closeMenu();
  }

  function handleDocumentFocusIn(event) {
    if (menuOpen && !elements.profileControl.contains(event.target)) closeMenu();
  }

  function handleDocumentKeyDown(event) {
    if (event.key !== 'Escape' || !menuOpen) return;
    event.preventDefault();
    closeMenu({ restoreFocus: true });
  }

  function handleStorage(event) {
    if (destroyed || (event.key !== null
        && event.key !== PROFILES_STORAGE_KEY
        && event.key !== ACTIVE_PROFILE_STORAGE_KEY)) return;
    const nextProfiles = readProfiles();
    const nextActiveProfileId = readActiveProfileId(nextProfiles);
    profiles = nextProfiles;
    activeProfileId = nextActiveProfileId;
    renderProfileList();
    renderActiveProfile();
    if (activeProfile()) {
      if (gateIsOpen() && currentView === 'chooser') closeGate();
    } else {
      if (profiles.length > 0) showChooser({ focus: false });
      else showEditor(null, { origin: 'initial', focus: false });
      openGate();
    }
  }

  elements.menuButton.addEventListener('click', () => {
    if (menuOpen) closeMenu();
    else openMenu();
  });
  elements.menuButton.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    openMenu({ focus: true, last: event.key === 'ArrowUp' });
  });
  elements.profileMenu.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const availableItems = focusableMenuItems();
    if (!availableItems.length) return;
    const currentIndex = availableItems.indexOf(document.activeElement);
    let nextIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = availableItems.length - 1;
    else if (currentIndex < 0) nextIndex = event.key === 'ArrowUp' ? availableItems.length - 1 : 0;
    else if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1 + availableItems.length) % availableItems.length;
    else nextIndex = (currentIndex - 1 + availableItems.length) % availableItems.length;
    focusElement(availableItems[nextIndex]);
  });

  elements.switchButton.addEventListener('click', () => {
    closeMenu();
    showChooser({ focus: false });
    openGate({ returnFocus: elements.menuButton });
  });
  elements.editButton.addEventListener('click', () => {
    const profile = activeProfile();
    if (!profile) return;
    closeMenu();
    showEditor(profile, { origin: 'menu', focus: false });
    openGate({ returnFocus: elements.menuButton });
  });
  elements.signOutButton.addEventListener('click', () => {
    closeMenu();
    activeProfileId = null;
    saveActiveProfileId(null);
    renderActiveProfile();
    if (profiles.length > 0) showChooser({ focus: false });
    else showEditor(null, { origin: 'initial', focus: false });
    openGate({ returnFocus: elements.menuButton });
  });

  elements.profileList.addEventListener('click', event => {
    const card = event.target.closest('[data-profile-id]');
    if (!card || !elements.profileList.contains(card)) return;
    activateProfile(card.dataset.profileId);
  });
  elements.addButton.addEventListener('click', () => {
    if (profiles.length >= MAX_PROFILES) return;
    showEditor(null, { origin: 'chooser' });
  });
  elements.presetList.addEventListener('click', event => {
    const button = event.target.closest('button[data-avatar]');
    if (!button || !elements.presetList.contains(button) || !PRESET_AVATARS.has(button.dataset.avatar)) return;
    draftPreset = button.dataset.avatar;
    draftAvatar = { type: 'preset', value: draftPreset };
    setEditorStatus();
    renderDraftAvatar();
  });
  elements.nameInput.addEventListener('input', () => {
    elements.nameInput.setCustomValidity('');
    elements.nameInput.setAttribute('aria-invalid', 'false');
    if (elements.editorStatus?.dataset.kind === 'name') setEditorStatus();
    renderDraftAvatar();
  });
  elements.avatarEditButton.addEventListener('click', () => elements.photoInput.click());
  elements.photoButton.addEventListener('click', () => elements.photoInput.click());
  elements.photoInput.addEventListener('change', () => { void selectPhoto(elements.photoInput.files?.[0]); });
  elements.photoRemove.addEventListener('click', () => {
    photoRevision += 1;
    draftAvatar = { type: 'preset', value: draftPreset };
    setEditorStatus();
    renderDraftAvatar();
    focusElement(elements.photoButton);
  });
  elements.editorBack.addEventListener('click', leaveEditor);
  elements.editorCancel.addEventListener('click', leaveEditor);
  elements.deleteButton.addEventListener('click', deleteEditingProfile);
  elements.editorForm.addEventListener('submit', submitEditor);

  elements.profileGate.addEventListener('cancel', event => {
    event.preventDefault();
    if (currentView === 'editor') leaveEditor();
    else if (activeProfile()) closeGate();
  });
  elements.profileGate.addEventListener('click', event => {
    if (event.target === elements.profileGate && activeProfile()) closeGate();
  });
  elements.profileGate.addEventListener('close', () => {
    elements.profileGate.classList.remove('is-open');
    if (!activeProfile()) {
      elements.profileGate.hidden = false;
      queueMicrotask(() => {
        if (!destroyed && !gateIsOpen()) openGate({ returnFocus: gateReturnFocus });
      });
      return;
    }
    elements.profileGate.hidden = true;
    restoreGateFocus();
  });

  document.addEventListener('pointerdown', handleDocumentPointerDown, true);
  document.addEventListener('focusin', handleDocumentFocusIn);
  document.addEventListener('keydown', handleDocumentKeyDown);
  window.addEventListener('storage', handleStorage);

  renderProfileList();
  renderActiveProfile();
  if (activeProfile()) {
    elements.profileGate.hidden = true;
  } else {
    if (profiles.length > 0) showChooser({ focus: false });
    else showEditor(null, { origin: 'initial', focus: false });
    openGate();
  }

  const api = {
    get activeProfile() {
      const profile = activeProfile();
      return profile ? { ...profile, avatar: { ...profile.avatar } } : null;
    },
    openChooser() {
      showChooser({ focus: false });
      openGate({ returnFocus: elements.menuButton });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      photoRevision += 1;
      closeMenu();
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
      document.removeEventListener('focusin', handleDocumentFocusIn);
      document.removeEventListener('keydown', handleDocumentKeyDown);
      window.removeEventListener('storage', handleStorage);
      instances.delete(elements.profileGate);
    },
  };
  instances.set(elements.profileGate, api);
  return api;
}
