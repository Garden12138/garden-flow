import compatibility from '../../shared/brandCompatibility.cjs';

// Run before stores and bridge modules read preferences. Never remove old keys.
for (const storage of [window.localStorage, window.sessionStorage]) {
    compatibility.migrateStorage(storage);
}
