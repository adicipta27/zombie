// game-logic.js - Mesin Utama Simulasi Desa (Full Features: Pause on Offline, Gotong-Royong, Storage Cap, Glitch, Profil Akun & Statistik)
import { 
    auth, 
    db, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged,
    ref, 
    set, 
    get, 
    update,
    onValue,
    push,
    remove
} from "./firebase-config.js";

import { governmentMissions, allianceMissions, initialWarMapNodes } from "./game-config.js";

let game = {
    food: 100,
    wood: 15,
    metal: 0,
    chemicals: 0,
    pop: 5,
    maxPop: 5,
    houseLevel: 1,
    wallHealth: 100,
    wallLevel: 1,
    tier: 1,
    workers: { farm: 0, wall: 0 },
    timers: { production: 30, zombie: 120, event: 180 },
    currentMissionIndex: 0,
    currentAllianceMissionIndex: 0,
    expeditionCooldown: 0,
    warMapActiveMission: null,
    warMapTimer: 0,
    nodeCooldowns: {}, 
    lastLogoutTime: Date.now(),
    stats: {
        totalExpeditions: 0,
        totalZombiesKilled: 0,
        totalRepairs: 0
    }
};

let allianceStorage = {
    food: 0,
    wood: 0,
    metal: 0,
    chemicals: 0
};

let warMapNodes = [...initialWarMapNodes];
let onlinePlayers = {}; 
let nextZombieThreat = "Standar"; 
let currentTab = 'village';
let currentUserEmail = "";
let userUid = "";
let activeEventTimerInterval = null;

// Sistem Batas Kapasitas Gudang (Storage Cap) berdasarkan Level Rumah & Benteng
function getStorageCap() {
    return (game.houseLevel * 300) + (game.wallLevel * 200) + 200;
}

function saveGameToCloud() {
    if (!userUid) return;
    game.lastLogoutTime = Date.now(); // Simpan waktu aktif terakhir ke cloud
    const gameRef = ref(db, `users/${userUid}/gameState`);
    set(gameRef, game).catch((error) => {
        console.error("Gagal menyimpan data ke cloud:", error);
    });
}

function loadGameFromCloud(uid) {
    const gameRef = ref(db, `users/${uid}/gameState`);
    get(gameRef).then((snapshot) => {
        if (snapshot.exists()) {
            game = snapshot.val();
            
            if (typeof game.metal !== 'number') game.metal = 0;
            if (typeof game.chemicals !== 'number') game.chemicals = 0;
            if (typeof game.warMapTimer !== 'number' || isNaN(game.warMapTimer)) game.warMapTimer = 0;
            if (game.warMapActiveMission === undefined) game.warMapActiveMission = null;
            if (!game.nodeCooldowns) game.nodeCooldowns = {};

            if (!game.stats) {
                game.stats = { totalExpeditions: 0, totalZombiesKilled: 0, totalRepairs: 0 };
            }
            if (typeof game.currentAllianceMissionIndex !== 'number' || game.currentAllianceMissionIndex >= allianceMissions.length) {
                game.currentAllianceMissionIndex = 0;
            }
            if (typeof game.currentMissionIndex !== 'number' || game.currentMissionIndex >= governmentMissions.length) {
                game.currentMissionIndex = 0;
            }

            // [FITUR PAUSE ON OFFLINE] Cek durasi offline tanpa mengubah sedikit pun data desa
            let now = Date.now();
            if (game.lastLogoutTime) {
                let offlineDurationSecs = Math.floor((now - game.lastLogoutTime) / 1000);
                log(`[SISTEM] Sektor dijeda selama offline (${Math.floor(offlineDurationSecs / 60)} menit). Tidak ada perubahan data terjadi.`);
            }

        } else {
            game.currentAllianceMissionIndex = 0;
            game.lastLogoutTime = Date.now();
            saveGameToCloud();
            log("[SISTEM] Memulai lembaran desa baru.");
        }
        updateUI();
        renderPanel();
    }).catch((error) => {
        console.error("Gagal memuat data:", error);
    });
}

function updateUserStatus(status) {
    if (!userUid) return;
    const username = currentUserEmail.split('@')[0];
    const userStatusRef = ref(db, `status/${userUid}`);
    set(userStatusRef, {
        name: username,
        state: status,
        lastActive: Date.now()
    });
}

function monitorOnlinePlayers() {
    const statusRef = ref(db, 'status');
    onValue(statusRef, (snapshot) => {
        if (snapshot.exists()) {
            onlinePlayers = snapshot.val();
        } else {
            onlinePlayers = {};
        }
        if (currentTab === 'coop') renderPanel();
    });
}

function syncWarMapData() {
    const warMapRef = ref(db, 'warMapNodes');
    onValue(warMapRef, (snapshot) => {
        if (snapshot.exists()) {
            let cloudNodes = snapshot.val();
            warMapNodes = initialWarMapNodes.map(defaultNode => {
                let cloudNode = cloudNodes.find(n => n.id === defaultNode.id);
                if (cloudNode) {
                    return {
                        ...defaultNode,
                        ...cloudNode,
                        level: cloudNode.level !== undefined ? cloudNode.level : defaultNode.level,
                        targetPoints: cloudNode.targetPoints !== undefined ? cloudNode.targetPoints : defaultNode.targetPoints,
                        currentPoints: cloudNode.currentPoints !== undefined ? cloudNode.currentPoints : defaultNode.currentPoints
                    };
                }
                return defaultNode;
            });

            let hasChanges = false;
            warMapNodes.forEach(node => {
                if (node.status === 'unlocked' && Math.random() < 0.05) {
                    node.status = 'locked';
                    node.currentPoints = 0; 
                    hasChanges = true;
                    log(`⚠️ [DEGRADASI ZONA] Gerombolan zombie menyusup dan merebut kembali Sektor ${node.name}! Status kembali terkunci.`);
                }
            });
            if (hasChanges) {
                set(warMapRef, warMapNodes);
            }

        } else {
            set(warMapRef, initialWarMapNodes);
            warMapNodes = [...initialWarMapNodes];
        }
        if (currentTab === 'warmap') renderPanel();
    });
}

window.handleRegister = async function() {
    let email = document.getElementById('authEmail').value;
    let pass = document.getElementById('authPassword').value;
    let errBox = document.getElementById('authError');
    errBox.innerText = "";

    try {
        await createUserWithEmailAndPassword(auth, email, pass);
        alert("Pendaftaran Berhasil! Selamat datang di Desa Penyintas.");
    } catch (error) {
        errBox.innerText = "Gagal Daftar: " + error.message;
    }
}

window.handleLogin = async function() {
    let email = document.getElementById('authEmail').value;
    let pass = document.getElementById('authPassword').value;
    let errBox = document.getElementById('authError');
    errBox.innerText = "";

    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (error) {
        errBox.innerText = "Gagal Masuk: " + error.message;
    }
}

window.handleLogout = async function() {
    if (userUid) {
        saveGameToCloud();
        updateUserStatus("offline");
    }
    await signOut(auth);
}

// Fitur Reset Total dengan Kode Akses maryadi27
window.handleResetTotal = function() {
    if (!userUid) return;
    let passInput = document.getElementById('resetPasswordInput');
    let errBox = document.getElementById('resetErrorMsg');
    if (passInput) passInput.value = "";
    if (errBox) errBox.innerText = "";

    let modal = document.getElementById('resetModal');
    if (modal) modal.style.display = 'flex';
}

window.closeResetModal = function() {
    let modal = document.getElementById('resetModal');
    if (modal) modal.style.display = 'none';
}

window.verifyAndExecuteReset = async function() {
    let passInput = document.getElementById('resetPasswordInput');
    let errBox = document.getElementById('resetErrorMsg');
    
    if (!passInput) return;

    if (passInput.value !== "maryadi27") {
        errBox.innerText = "❌ Kode akses salah! Reset dibatalkan.";
        return;
    }

    closeResetModal();

    game = {
        food: 100,
        wood: 15,
        metal: 0,
        chemicals: 0,
        pop: 5,
        maxPop: 5,
        houseLevel: 1,
        wallHealth: 100,
        wallLevel: 1,
        tier: 1,
        workers: { farm: 0, wall: 0 },
        timers: { production: 30, zombie: 120, event: 180 },
        currentMissionIndex: 0,
        currentAllianceMissionIndex: 0,
        expeditionCooldown: 0,
        warMapActiveMission: null,
        warMapTimer: 0,
        nodeCooldowns: {}, 
        lastLogoutTime: Date.now(),
        stats: { totalExpeditions: 0, totalZombiesKilled: 0, totalRepairs: 0 }
    };

    try {
        const gameRef = ref(db, `users/${userUid}/gameState`);
        await set(gameRef, game);
        log("[SISTEM] 🔄 Sektor berhasil di-reset total dengan kode keamanan! Data dikembalikan dari awal.");
        alert("Sektor berhasil di-reset total!");
        updateUI();
        renderPanel();
    } catch (error) {
        console.error("Gagal mereset data:", error);
        alert("Gagal mereset data ke server.");
    }
}

window.addEventListener('beforeunload', () => {
    if (userUid) {
        saveGameToCloud();
        updateUserStatus("offline");
    }
});

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUserEmail = user.email;
        userUid = user.uid;
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('gameMainUI').style.display = 'flex';
        log(`[SISTEM] Komandan terverifikasi: ${currentUserEmail}`);
        
        updateUserStatus("online");
        monitorOnlinePlayers();
        syncWarMapData();
        loadGameFromCloud(userUid);
        syncAllianceStorage(); 
    } else {
        currentUserEmail = "";
        userUid = "";
        document.getElementById('authScreen').style.display = 'flex';
        document.getElementById('gameMainUI').style.display = 'none';
    }
});

function log(msg) {
    let t = document.getElementById('terminalLog');
    if(t) {
        t.innerHTML += `<br>> ${msg}`;
        t.scrollTop = t.scrollHeight;
    }
}

function triggerFullGlitchAndSound(sfxType) {
    if (typeof playSFX === 'function') {
        playSFX(sfxType);
    }
    let body = document.body;
    body.classList.add('global-glitch');
    setTimeout(() => {
        body.classList.remove('global-glitch');
    }, 1800);
}

function getFreePop() {
    return game.pop - (game.workers.farm + game.workers.wall);
}

window.switchTab = function(tabName, element) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    if(element) element.classList.add('active');
    currentTab = tabName;
    updateBodyBackground();
    renderPanel();
}

function updateBodyBackground() {
    const bgImages = {
        village: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1600&q=80",
        expedition: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1600&q=80",
        warmap: "https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?auto=format&fit=crop&w=1600&q=80",
        missions: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1600&q=80",
        upgrade: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=1600&q=80",
        coop: "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1600&q=80"
    };
    let selectedBg = bgImages[currentTab] || bgImages.village;
    document.body.style.backgroundImage = `url('${selectedBg}')`;
}

function checkTierProgression() {
    if (game.tier === 1 && game.pop >= 10 && game.wallLevel >= 2) {
        game.tier = 2;
        log("🎉 [STATUS DESA NAIK] Desa naik ke Tier 2: Pemukiman Berdikari!");
    } else if (game.tier === 2 && game.pop >= 20 && game.wallLevel >= 4) {
        game.tier = 3;
        log("🏆 [KOTA BENTENG SEJATI] Desa naik ke Tier 3: Zona Aman Mandiri!");
    }
}

function formatTimeHMS(totalSeconds) {
    if (totalSeconds <= 0) return "00:00:00";
    let hrs = Math.floor(totalSeconds / 3600);
    let mins = Math.floor((totalSeconds % 3600) / 60);
    let secs = totalSeconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// 20 Random Event Pop-Up Interaktif dengan Custom HTML Modal & Countdown 15s
function triggerRandomEvent() {
    triggerFullGlitchAndSound('event_alert');
    const events = [
        {
            title: "Penyusup Panik",
            desc: "Seseorang menggedor gerbang desa dengan panik sambil dikejar gerombolan kecil.",
            action1Text: "[Opsi A] Buka Gerbang (+1 Warga, Benteng -5%)",
            action2Text: "[Opsi B] Tolak & Abaikan (Aman)",
            effect1: () => { game.pop = Math.min(game.maxPop, game.pop + 1); game.wallHealth = Math.max(0, game.wallHealth - 5); log("⚡ [EVENT] Gerbang dibuka! Warga baru bergabung, benteng sedikit tertekan."); },
            effect2: () => { log("⚡ [EVENT] Pintu gerbang ditutup rapat. Penyusup terabaikan."); }
        },
        {
            title: "Tikus Gudang",
            desc: "Tikus-tikus liar mulai menggerogoti cadangan lumbung pangan utama!",
            action1Text: "[Opsi A] Basmi Cepat (-5 Beras, Selamatkan Stok)",
            action2Text: "[Opsi B] Biarkan Saja (-20 Beras)",
            effect1: () => { game.food = Math.max(0, game.food - 5); log("⚡ [EVENT] Pembasmian tikus cepat berhasil mengamankan lumbung."); },
            effect2: () => { game.food = Math.max(0, game.food - 20); log("⚡ [EVENT] Tikus merusak cadangan pangan! -20kg Beras."); }
        },
        {
            title: "Hujan Asam Korosif",
            desc: "Cuaca buruk membawa zat asam yang mulai mengikis struktur luar benteng.",
            action1Text: "[Opsi A] Lapisi Pakai 10 Kayu",
            action2Text: "[Opsi B] Abaikan (-15% Durasi Benteng)",
            effect1: () => { 
                if(game.wood >= 10) { game.wood -= 10; log("⚡ [EVENT] Kayu digunakan untuk melapisi benteng dari korosi."); }
                else { game.wallHealth = Math.max(0, game.wallHealth - 15); log("⚡ [EVENT] Kayu tidak cukup, benteng terkikis asam!"); }
            },
            effect2: () => { game.wallHealth = Math.max(0, game.wallHealth - 15); log("⚡ [EVENT] Hujan asam merusak struktur benteng -15%!"); }
        },
        {
            title: "Pedagang Gelap Keliling",
            desc: "Seorang penyintas misterius menawarkan barter logistik darurat.",
            action1Text: "[Opsi A] Tukar 50 Kayu dengan Beras",
            action2Text: "[Opsi B] Tolak Penawaran",
            effect1: () => {
                if(game.wood >= 50) {
                    game.wood -= 50;
                    let cap = getStorageCap();
                    game.food = Math.min(cap, game.food + 70);
                    log("⚡ [EVENT] Barter sukses! Memperoleh +70kg Beras.");
                } else { log("⚡ [EVENT] Kayu tidak cukup untuk barter."); }
            },
            effect2: () => { log("⚡ [EVENT] Pedagang gelap pergi meninggalkan desa."); }
        },
        {
            title: "Wabah Demam Ringan",
            desc: "Beberapa warga mendadak jatuh sakit akibat cuaca dingin ekstrem.",
            action1Text: "[Opsi A] Karantina Warga (Aman)",
            action2Text: "[Opsi B] Biarkan (-1 Populasi Gugur)",
            effect1: () => { log("⚡ [EVENT] Warga dikarantina. Pemulihan berjalan lancar."); },
            effect2: () => { game.pop = Math.max(1, game.pop - 1); log("⚡ [EVENT] Wabah menelan korban jiwa! Populasi berkurang 1 warga."); }
        },
        {
            title: "Kayu Hanyut Sungai",
            desc: "Aliran sungai meluap membawa banyak tumpukan kayu gelondongan bagus.",
            action1Text: "[Opsi A] Kumpulkan (+30 Kayu)",
            action2Text: "[Opsi B] Abaikan",
            effect1: () => { 
                let cap = getStorageCap();
                game.wood = Math.min(cap, game.wood + 30);
                log("⚡ [EVENT] Warga berhasil mengamankan +30 Kayu dari sungai."); 
            },
            effect2: () => { log("⚡ [EVENT] Kayu hanyut terbawa arus jauh."); }
        },
        {
            title: "Pemberontakan Pekerja",
            desc: "Para pekerja kebun merasa lelah dan menuntut jatah ekstra.",
            action1Text: "[Opsi A] Beri Bonus 20kg Beras",
            action2Text: "[Opsi B] Abaikan (Produksi Mandek)",
            effect1: () => { game.food = Math.max(0, game.food - 20); log("⚡ [EVENT] Bonus diberikan, semangat warga kembali membara."); },
            effect2: () => { log("⚡ [EVENT] Pekerja mogok, efisiensi panen turun siklus ini."); }
        },
        {
            title: "Serangan Anjing Liar",
            desc: "Kawanan anjing terinfeksi virus mendekati area kebun pangan.",
            action1Text: "[Opsi A] Basmi Segera (Aman)",
            action2Text: "[Opsi B] Biarkan [-10kg Beras]",
            effect1: () => { log("⚡ [EVENT] Anjing liar berhasil dihalau tanpa kerugian."); },
            effect2: () => { game.food = Math.max(0, game.food - 10); log("⚡ [EVENT] Anjing liar merusak area kebun pangan."); }
        },
        {
            title: "Korsleting Api Unggun",
            desc: "Percikan api dari perapian malam hari hampir membakar barak warga.",
            action1Text: "[Opsi A] Padamkan (-5 Kayu)",
            action2Text: "[Opsi B] Terlambat [-20 Kayu]",
            effect1: () => { 
                if(game.wood >= 5) { game.wood -= 5; log("⚡ [EVENT] Api dipadamkan cepat dengan kerugian minimal."); }
                else { game.wood = 0; log("⚡ [EVENT] Kayu habis tersapu api kecil."); }
            },
            effect2: () => { game.wood = Math.max(0, game.wood - 20); log("⚡ [EVENT] Api melalap sebagian barak! -20 Kayu."); }
        },
        {
            title: "Pengungsi Membawa Anak",
            desc: "Sebuah keluarga kecil meminta suaka perlindungan di pos terluar.",
            action1Text: "[Opsi A] Terima Pengungsi (+2 Populasi)",
            action2Text: "[Opsi B] Tolak Suaka",
            effect1: () => { game.pop = Math.min(game.maxPop, game.pop + 2); log("⚡ [EVENT] Keluarga pengungsi diterima berlindung di desa."); },
            effect2: () => { log("⚡ [EVENT] Pengungsi berjalan pergi meninggalkan wilayah."); }
        },
        {
            title: "Temuan Apotek Liar",
            desc: "Regu patroli menemukan apotek terbengkalai yang masih utuh stok obatnya.",
            action1Text: "[Opsi A] Ambil Cadangan Obat",
            action2Text: "[Opsi B] Abaikan",
            effect1: () => { log("⚡ [EVENT] Cadangan obat diamankan, kesehatan warga meningkat drastis!"); },
            effect2: () => { log("⚡ [EVENT] Lokasi apotek dibiarkan begitu saja."); }
        },
        {
            title: "Gempa Mikro Lokal",
            desc: "Guncangan kecil mendadak terjadi dan membuat struktur tanah bergeser.",
            action1Text: "[Opsi A] Periksa Kerusakan",
            action2Text: "[Opsi B] Biarkan Benteng Retak (-10% HP)",
            effect1: () => { log("⚡ [EVENT] Pemeriksaan cepat menyelamatkan struktur dari kerusakan parah."); },
            effect2: () => { game.wallHealth = Math.max(0, game.wallHealth - 10); log("⚡ [EVENT] Gempa menyebabkan benteng retak -10%."); }
        },
        {
            title: "Gotong Royong Warga",
            desc: "Semangat kebersamaan warga sedang tinggi-tingginya hari ini.",
            action1Text: "[Opsi A] Syukuri (+ Surplus Beras)",
            action2Text: "[Opsi B] Abaikan",
            effect1: () => { 
                let cap = getStorageCap();
                game.food = Math.min(cap, game.food + 25);
                log("⚡ [EVENT] Gotong royong menghasilkan surplus +25kg Beras!"); 
            },
            effect2: () => { log("⚡ [EVENT] Suasana desa berjalan biasa saja."); }
        },
        {
            title: "Pencurian Malam Hari",
            desc: "Seseorang menyelinap dan mengambil tumpukan kayu di luar gerbang.",
            action1Text: "[Opsi A] Perketat Patroli",
            action2Text: "[Opsi B] Relakan Kehilangan (-15 Kayu)",
            effect1: () => { log("⚡ [EVENT] Patroli diperketat, pencuri kabur tanpa hasil."); },
            effect2: () => { game.wood = Math.max(0, game.wood - 15); log("⚡ [EVENT] Pencuri berhasil membawa kabur 15 unit kayu."); }
        },
        {
            title: "Kabut Tebal Misterius",
            desc: "Kabut pekat menyelimuti kawasan luar, membuat jarak pandang menjadi nol.",
            action1Text: "[Opsi A] Hentikan Aktivitas Luar",
            action2Text: "[Opsi B] Tetap Nekat",
            effect1: () => { log("⚡ [EVENT] Aktivitas luar dihentikan demi keselamatan tim."); },
            effect2: () => { game.wallHealth = Math.max(0, game.wallHealth - 5); log("⚡ [EVENT] Tim luar tersesat dalam kabut dan benteng terserempet."); }
        },
        {
            title: "Burung Gagak Pembawa Pesan",
            desc: "Peringatan dini dari aliansi diterima mengenai potensi cuaca buruk.",
            action1Text: "[Opsi A] Siagakan Benteng",
            action2Text: "[Opsi B] Abaikan",
            effect1: () => { log("⚡ [EVENT] Pertahanan disiagakan lebih awal sesuai peringatan."); },
            effect2: () => { log("⚡ [EVENT] Pesan diabaikan begitu saja."); }
        },
        {
            title: "Badai Salju Dingin",
            desc: "Suhu mendadak turun drastis membuat seluruh warga menggigil kedinginan.",
            action1Text: "[Opsi A] Bakar 15 Kayu untuk Penghangat",
            action2Text: "[Opsi B] Biarkan (Warga Sakit)",
            effect1: () => {
                if(game.wood >= 15) { game.wood -= 15; log("⚡ [EVENT] Api penghangat dinyalakan, warga selamat dari dingin."); }
                else { game.wallHealth = Math.max(0, game.wallHealth - 10); log("⚡ [EVENT] Kayu kurang, dingin membekukan sebagian pos."); }
            },
            effect2: () => { log("⚡ [EVENT] Suhu dingin membuat beberapa warga jatuh sakit."); }
        },
        {
            title: "Kerusakan Pagar Samping",
            desc: "Ada retakan kecil pada dinding kayu luar yang mulai melunak.",
            action1Text: "[Opsi A] Perbaiki Kilat Pakai 5 Kayu",
            action2Text: "[Opsi B] Biarkan",
            effect1: () => {
                if(game.wood >= 5) { game.wood -= 5; log("⚡ [EVENT] Pagar samping sukses diperbaiki kilat."); }
                else { log("⚡ [EVENT] Kayu tidak cukup untuk memperbaiki pagar."); }
            },
            effect2: () => { game.wallHealth = Math.max(0, game.wallHealth - 5); log("⚡ [EVENT] Pagar dibiarkan retak dan makin melemah."); }
        },
        {
            title: "Panen Raya Dadakan",
            desc: "Tanah di kebun pangan mendadak menjadi jauh lebih subur dari perkiraan.",
            action1Text: "[Opsi A] Panen Melimpah (+40 Beras)",
            action2Text: "[Opsi B] Abaikan",
            effect1: () => {
                let cap = getStorageCap();
                game.food = Math.min(cap, game.food + 40);
                log("⚡ [EVENT] Panen raya sukses besar! +40kg Beras.");
            },
            effect2: () => { log("⚡ [EVENT] Kesempatan panen raya terlewat."); }
        },
        {
            title: "Suar Darurat Desa Sebelah",
            desc: "Sinyal suar terlihat meminta bantuan evakuasi warga sipil yang terjebak.",
            action1Text: "[Opsi A] Kirim Tim Evakuasi (+1 Warga)",
            action2Text: "[Opsi B] Abaikan Suar",
            effect1: () => {
                game.pop = Math.min(game.maxPop, game.pop + 1);
                log("⚡ [EVENT] Tim evakuasi berhasil menyelamatkan 1 penyintas baru.");
            },
            effect2: () => { log("⚡ [EVENT] Suar darurat padam tanpa bantuan."); }
        }
    ];

    let randomEv = events[Math.floor(Math.random() * events.length)];
    let modal = document.getElementById('customEventModal');
    let titleEl = document.getElementById('modalEventTitle');
    let descEl = document.getElementById('modalEventDesc');
    let timerEl = document.getElementById('modalEventTimer');
    let btn1 = document.getElementById('modalBtnAction1');
    let btn2 = document.getElementById('modalBtnAction2');

    if (!modal) return;

    titleEl.innerText = `🚨 [DARURAT SEKTOR] ${randomEv.title}`;
    descEl.innerText = randomEv.desc;
    btn1.innerText = randomEv.action1Text;
    btn2.innerText = randomEv.action2Text;

    let timeLeft = 15;
    timerEl.innerText = `⏱️ ${timeLeft}s`;
    modal.style.display = 'flex';

    if (activeEventTimerInterval) clearInterval(activeEventTimerInterval);

    function closeEventModal(choice) {
        clearInterval(activeEventTimerInterval);
        modal.style.display = 'none';
        if (choice === 1) {
            randomEv.effect1();
        } else {
            randomEv.effect2();
            log(`⏱️ [WAKTU HABIS] Keputusan terlambat diambil! Opsi alternatif (Abaikan/Pasif) dijalankan.`);
        }
        updateUI();
        saveGameToCloud();
    }

    btn1.onclick = () => closeEventModal(1);
    btn2.onclick = () => closeEventModal(2);

    activeEventTimerInterval = setInterval(() => {
        timeLeft--;
        timerEl.innerText = `⏱️ ${timeLeft}s`;
        if (timeLeft <= 0) {
            closeEventModal(2); // Waktu habis otomatis memilih Opsi B (Abaikan)
        }
    }, 1000);
}

function renderPanel() {
    let panel = document.getElementById('mainPanel');
    if(!panel) return;
    panel.innerHTML = '';
    updateBodyBackground();
    let storageCap = getStorageCap();
    let username = currentUserEmail ? currentUserEmail.split('@')[0] : "Komandan";

    // Header Tambahan: Card Profil & Statistik Personal Komandan
    let profileBoxHtml = `
        <div class="card-box" style="border-color: var(--accent-gold); margin-bottom: 12px; background: rgba(12, 13, 15, 0.9);">
            <div class="card-header" style="border-bottom: 1px solid var(--border-color); padding-bottom: 4px; margin-bottom: 6px;">
                <h5 style="color: var(--accent-gold);">🪖 PROFIL KOMANDAN: <span style="color: #fff;">${username}</span></h5>
                <span style="font-size: 10px; color: var(--accent-green);">ONLINE 🟢</span>
            </div>
            <div class="card-desc" style="display: flex; justify-content: space-between; font-size: 11px; flex-wrap: wrap; gap: 6px; color: #d1d5db;">
                <span>🔎 Ekspedisi: <b style="color:var(--accent-gold);">${game.stats ? game.stats.totalExpeditions : 0}</b></span>
                <span>🧟 Zombie Dikalahkan: <b style="color:var(--accent-red);">${game.stats ? game.stats.totalZombiesKilled : 0}</b></span>
                <span>🔨 Perbaikan Benteng: <b style="color:var(--accent-blue);">${game.stats ? game.stats.totalRepairs : 0}</b></span>
            </div>
        </div>
    `;

    if (currentTab === 'village') {
        panel.innerHTML = profileBoxHtml;
        panel.innerHTML += `<div class="section-title">Alokasi Tenaga Kerja Warga (Kapasitas Lumbung: ${storageCap} Unit)</div>`;
        panel.innerHTML += `
            <div class="card-box" style="border-color: var(--accent-blue);">
                <div class="card-header"><h5>📖 Buku Panduan & Tutorial</h5></div>
                <div class="card-desc">Buka dokumentasi strategi lengkap di jendela wiki baru.</div>
                <button class="btn-action" style="border-color: var(--accent-blue); color: var(--accent-blue); margin-top:8px;" onclick="window.open('tutorial.html', '_blank'); playSFX('click');">Buka Buku Panduan</button>
            </div>
        `;
        panel.innerHTML += `
            <div class="card-box">
                <div class="card-header">
                    <h5>🌾 Kebun Pangan Desa</h5>
                    <span style="color:var(--accent-green);">${game.workers.farm} Pekerja</span>
                </div>
                <div class="card-desc">Tiap pekerja menambah +6kg beras per 30 detik.</div>
                <div class="worker-controls">
                    <button class="btn-ctrl" onclick="adjustWorker('farm', -1); playSFX('click');">-</button>
                    <input type="number" id="inputAmountFarm" class="input-amount" value="1" min="1">
                    <button class="btn-ctrl" onclick="adjustWorker('farm', 1); playSFX('click');">+</button>
                </div>
            </div>
            <div class="card-box">
                <div class="card-header">
                    <h5>🛡️ Pos Benteng Penjagaan</h5>
                    <span style="color:var(--accent-blue);">${game.workers.wall} Penjaga</span>
                </div>
                <div class="card-desc">Mengurangi kerusakan benteng saat serangan zombie.</div>
                <div class="worker-controls">
                    <button class="btn-ctrl" onclick="adjustWorker('wall', -1); playSFX('click');">-</button>
                    <input type="number" id="inputAmountWall" class="input-amount" value="1" min="1">
                    <button class="btn-ctrl" onclick="adjustWorker('wall', 1); playSFX('click');">+</button>
                </div>
            </div>
            <div class="card-box">
                <div class="card-header">
                    <h5>🪵 Patroli & Pemulung Kayu</h5>
                    <span style="color:var(--text-muted);">${getFreePop()} Warga Bebas</span>
                </div>
                <div class="card-desc">Mencari Kayu dinamis otomatis per 30s & menekan risiko.</div>
            </div>
        `;
    } else if (currentTab === 'expedition') {
        panel.innerHTML = profileBoxHtml;
        panel.innerHTML += `<div class="section-title">Ekspedisi Bertingkat Luar Desa</div>`;
        panel.innerHTML += `
            <div class="card-box">
                <div class="card-header">
                    <h5>📍 Zona 1: Pinggiran Perumahan</h5>
                    <span style="color:var(--accent-green);">Terbuka</span>
                </div>
                <div class="card-desc">Hasil: Beras & Kayu Kecil (Cooldown: 20s).</div>
                <button class="btn-action" ${game.expeditionCooldown > 0 ? 'disabled' : ''} onclick="runExpedition(1); playSFX('click');">
                    ${game.expeditionCooldown > 0 ? `Tunggu (${game.expeditionCooldown}s)` : 'Kirim Tim'}
                </button>
            </div>
        `;
        let z2Unlocked = game.tier >= 2 && game.workers.wall >= 2;
        panel.innerHTML += `
            <div class="card-box">
                <div class="card-header">
                    <h5>📍 Zona 2: Pertokoan & Apotek</h5>
                    <span style="color:${z2Unlocked ? 'var(--accent-green)' : 'var(--accent-red)'};">${z2Unlocked ? 'Terbuka' : 'Terkunci (Tier 2 & 2 Penjaga)'}</span>
                </div>
                <div class="card-desc">Hasil: Beras Melimpah & Kayu Bagus.</div>
                <button class="btn-action" ${!z2Unlocked || game.expeditionCooldown > 0 ? 'disabled' : ''} onclick="runExpedition(2); playSFX('click');">
                    ${game.expeditionCooldown > 0 ? `Tunggu (${game.expeditionCooldown}s)` : 'Kirim Tim'}
                </button>
            </div>
        `;
        let z3Unlocked = game.tier >= 3 && game.food >= 150;
        panel.innerHTML += `
            <div class="card-box">
                <div class="card-header">
                    <h5>📍 Zona 3: Gudang Bulog</h5>
                    <span style="color:${z3Unlocked ? 'var(--accent-green)' : 'var(--accent-red)'};">${z3Unlocked ? 'Terbuka' : 'Terkunci (Tier 3 & 150kg Beras)'}</span>
                </div>
                <div class="card-desc">Bekal: 20kg Beras. Hasil: Kayu Raksasa & Logistik Super.</div>
                <button class="btn-action" ${!z3Unlocked || game.expeditionCooldown > 0 ? 'disabled' : ''} onclick="runExpedition(3); playSFX('click');">
                    ${game.expeditionCooldown > 0 ? `Tunggu (${game.expeditionCooldown}s)` : 'Kirim Tim Taktis'}
                </button>
            </div>
        `;
    } else if (currentTab === 'warmap') {
        panel.innerHTML = profileBoxHtml;
        panel.innerHTML += `<div class="section-title">🗺️ Peta Eksplorasi Bersama (Farmable Node & Real-time Cooldown)</div>`;
        let nodesHtml = '';
        let now = Date.now();
        warMapNodes.forEach(node => {
            let isUnlocked = node.status === 'unlocked';
            let statusColor = isUnlocked ? 'var(--accent-green)' : 'var(--accent-red)';
            let progressPct = isUnlocked ? 100 : Math.min(100, Math.floor((node.currentPoints / node.targetPoints) * 100));
            let cooldownEnd = (game.nodeCooldowns && game.nodeCooldowns[node.id]) ? game.nodeCooldowns[node.id] : 0;
            let isOnCooldown = now < cooldownEnd;
            let badgeText = isUnlocked ? `Dikuasai (Farm)` : `Lv.${node.level} (${progressPct}%)`;
            if (isOnCooldown) statusColor = 'var(--accent-gold)'; 

            nodesHtml += `
                <div style="position: absolute; top: ${node.y}%; left: ${node.x}%; transform: translate(-50%, -50%); text-align: center; cursor: pointer;" onclick="openWarMapNodeModal(${node.id}); playSFX('click');">
                    <div style="width: 28px; height: 28px; background: ${statusColor}; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; border: 1px solid var(--border-color); box-shadow: 0 0 8px rgba(0,0,0,0.8); font-weight:bold;">📍</div>
                    <span style="font-size: 8px; background: var(--surface-color); border: 1px solid var(--border-color); padding: 2px 4px; color: var(--text-main); white-space: nowrap; display: block; margin-top: 2px;">${node.name}</span>
                    <span style="font-size: 7.5px; background: #0c0d0f; border: 1px solid var(--border-color); padding: 1px 3px; color: var(--accent-blue); white-space: nowrap; display: block; margin-top: 1px;">${badgeText}</span>
                </div>
            `;
        });
        let activeMissionBox = '';
        if (game.warMapActiveMission !== null) {
            if (typeof game.warMapTimer !== 'number' || isNaN(game.warMapTimer)) game.warMapTimer = 300;
            let activeNode = warMapNodes.find(n => n.id === game.warMapActiveMission);
            let timeFormatted = formatTimeHMS(game.warMapTimer);
            activeMissionBox = `
                <div class="card-box" style="border-color: var(--accent-blue);">
                    <div class="card-header"><h5>⏳ Operasi Taktis Sektor: ${activeNode ? activeNode.name : ''}</h5></div>
                    <div class="card-desc">Tim sedang berjuang di lapangan... Sisa Waktu: <b id="warMapCountdownDisplay" style="color:var(--accent-blue); font-size:11px;">${timeFormatted}</b></div>
                </div>
            `;
        }
        panel.innerHTML += `
            ${activeMissionBox}
            <div style="position: relative; width: 100%; height: 260px; background: url('https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?auto=format&fit=crop&w=800&q=80') center/cover no-repeat; border-radius: 4px; border: 1px solid var(--border-color); margin-bottom: 12px; overflow:hidden;">
                <div style="position: absolute; inset: 0; background: rgba(12, 13, 15, 0.75);"></div>
                ${nodesHtml}
            </div>
            <div class="card-desc" style="text-align: center;">Klik pin titik wilayah untuk berkontribusi atau memanen ulang. Cooldown pribadi 1 Jam per titik.</div>
        `;
    } else if (currentTab === 'missions') {
        panel.innerHTML = profileBoxHtml;
        panel.innerHTML += `<div class="section-title">Papan Misi Operasi Pemerintah (50 Tahap)</div>`;
        if (game.currentMissionIndex < governmentMissions.length) {
            let m = governmentMissions[game.currentMissionIndex];
            let currentVal = getMissionProgress(m.reqType);
            let isReady = currentVal >= m.reqValue;
            panel.innerHTML += `
                <div class="card-box">
                    <div class="card-header">
                        <h5>${m.title}</h5>
                        <span style="color:var(--text-muted);">Misi ${game.currentMissionIndex + 1} / 50</span>
                    </div>
                    <div class="card-desc">${m.desc}</div>
                    <div style="font-size:11px; color:var(--accent-gold); margin:6px 0;">Progres: <b>${currentVal} / ${m.reqValue}</b></div>
                    <button class="btn-action" style="border-color:${isReady ? 'var(--accent-green)' : 'var(--border-color)'}; color:${isReady ? 'var(--accent-green)' : 'var(--text-muted)'};" ${!isReady ? 'disabled' : ''} onclick="claimMission(); playSFX('click');">
                        ${isReady ? 'Klaim Hadiah (🪵 ' + m.rewardWood + ' Kayu)' : 'Belum Selesai'}
                    </button>
                </div>
            `;
        } else {
            panel.innerHTML += `<div class="card-box"><p style="font-size:12px; color:var(--accent-green);">🏆 Seluruh 50 Misi Pemerintah Selesai! Anda Legenda Nusantara!</p></div>`;
        }
    } else if (currentTab === 'upgrade') {
        panel.innerHTML = profileBoxHtml;
        panel.innerHTML += `<div class="section-title">Pembangunan & Struktur Desa</div>`;
        let houseCost = game.houseLevel * 10;
        panel.innerHTML += `
            <div class="card-box">
                <div class="card-header"><h5>🏠 Upgrade Rumah (Lv. ${game.houseLevel})</h5></div>
                <div class="card-desc">+5 Kapasitas Warga & Kapasitas Lumbung. Biaya: 🪵 ${houseCost} Kayu.</div>
                <button class="btn-action" style="margin-top:8px;" onclick="upgradeHouse(); playSFX('click');">Upgrade Rumah</button>
            </div>
        `;
        let wallCost = game.wallLevel * 15;
        let metalReq = game.wallLevel >= 3 ? 10 : 0;
        panel.innerHTML += `
            <div class="card-box">
                <div class="card-header"><h5>🛡️ Upgrade Benteng (Lv. ${game.wallLevel})</h5></div>
                <div class="card-desc">Meningkatkan pertahanan. Biaya: 🪵 ${wallCost} Kayu ${metalReq > 0 ? `| 🔩 ${metalReq} Logam` : ''}.</div>
                <button class="btn-action" style="border-color:var(--accent-blue); color:var(--accent-blue); margin-top:8px;" ${game.wallLevel >= 4 ? 'disabled' : ''} onclick="upgradeWall(); playSFX('click');">
                    ${game.wallLevel >= 4 ? 'Maksimal (Lv. 4)' : 'Upgrade Benteng'}
                </button>
            </div>
        `;
        panel.innerHTML += `
            <div class="card-box">
                <div class="card-header"><h5>🔨 Perbaiki Benteng</h5></div>
                <div class="card-desc">Memulihkan +25% Ketahanan (Biaya: 🪵 5 Kayu per tahap).</div>
                <div class="worker-controls" style="margin-top:8px;">
                    <input type="number" id="inputRepairAmount" class="input-amount" value="1" min="1" style="width:60px;">
                    <button class="btn-action" style="border-color:var(--accent-gold); color:var(--accent-gold); width:auto;" onclick="repairWallCustom(); playSFX('click');">Perbaiki</button>
                </div>
            </div>
        `;
    } else if (currentTab === 'coop') {
        panel.innerHTML = profileBoxHtml;
        panel.innerHTML += `<div class="section-title">Pusat Aliansi & Status Anggota</div>`;
        let playersHtml = "";
        for (let uid in onlinePlayers) {
            let p = onlinePlayers[uid];
            let dotColor = p.state === 'online' ? 'var(--accent-green)' : 'var(--accent-red)';
            let statusText = p.state === 'online' ? 'Online 🟢' : 'Offline 🔴';
            playersHtml += `<div style="font-size:11px; display:flex; justify-content:space-between; margin-bottom:4px;">
                <span>👤 <b>${p.name}</b></span>
                <span style="color:${dotColor};">${statusText}</span>
            </div>`;
        }
        panel.innerHTML += `
            <div class="card-box">
                <div class="card-header"><h5>🟢 Daftar Komandan Aliansi</h5></div>
                <div style="max-height:100px; overflow-y:auto; margin-top:6px;">
                    ${playersHtml || '<span style="font-size:11px; color:var(--text-muted);">Memuat status anggota...</span>'}
                </div>
            </div>
            <div class="card-box" style="border-color: var(--accent-blue);">
                <div class="card-header"><h5>🏛️ Stok Gudang & Lumbung Aliansi</h5></div>
                <div class="card-desc" style="color:#f3f4f6;">🍚 <b>${allianceStorage.food} kg</b> | 🪵 <b>${allianceStorage.wood} Kayu</b> | 🔩 <b>${allianceStorage.metal || 0} Logam</b> | 🧪 <b>${allianceStorage.chemicals || 0} Kimia</b></div>
            </div>
        `;
        if (game.currentAllianceMissionIndex < allianceMissions.length) {
            let am = allianceMissions[game.currentAllianceMissionIndex];
            let currentAllianceVal = getAllianceMissionProgress(am.reqType);
            let isAllianceReady = currentAllianceVal >= am.reqValue;
            panel.innerHTML += `
                <div class="card-box" style="border-color: var(--accent-gold);">
                    <div class="card-header">
                        <h5>🏆 ${am.title}</h5>
                        <span style="color: var(--accent-gold);">Misi Aliansi ${game.currentAllianceMissionIndex + 1} / 20</span>
                    </div>
                    <div class="card-desc">${am.desc}</div>
                    <div style="font-size:11px; color:var(--accent-gold); margin:6px 0;">Progres: <b>${currentAllianceVal} / ${am.reqValue}</b></div>
                    <button class="btn-action" style="border-color:${isAllianceReady ? 'var(--accent-gold)' : 'var(--border-color)'}; color:${isAllianceReady ? 'var(--accent-gold)' : 'var(--text-muted)'};" ${!isAllianceReady ? 'disabled' : ''} onclick="claimAllianceMission(); playSFX('click');">
                        ${isAllianceReady ? 'Klaim Hadiah Aliansi (🪵 ' + am.rewardWood + ' Kayu)' : 'Belum Selesai'}
                    </button>
                </div>
            `;
        }
        panel.innerHTML += `
            <div class="card-box">
                <div class="card-header"><h5>📦 Donasi Logistik ke Aliansi</h5></div>
                <div style="display:flex; gap:6px; margin-top:8px; align-items:center;">
                    <select id="donateType" class="input-amount" style="width:110px;">
                        <option value="food">Beras (kg)</option>
                        <option value="wood">Kayu (unit)</option>
                        <option value="metal">Logam</option>
                        <option value="chemicals">Kimia</option>
                    </select>
                    <input type="number" id="donateQty" class="input-amount" value="20" min="5" style="width:70px;">
                    <button class="btn-action" style="border-color:var(--accent-green); color:var(--accent-green); width:auto;" onclick="donateToAlliance(); playSFX('click');">Donasi</button>
                </div>
            </div>
            <div class="card-box">
                <div class="card-header"><h5>💬 Chat Aliansi Real-Time</h5></div>
                <div id="coopChatBox" class="chat-box" style="height:120px; overflow-y:auto; margin:8px 0; font-size:11.5px; color:var(--text-muted);">&gt; [SISTEM] Terhubung ke Jaringan Aliansi...</div>
                <div style="display:flex; gap:6px;">
                    <input type="text" id="chatInputMsg" class="input-field" placeholder="Ketik pesan..." style="flex-grow:1; margin-bottom:0;" onkeypress="handleChatKeyPress(event)">
                    <button class="btn-action" style="width:70px;" onclick="sendAllianceChat(); playSFX('click');">Kirim</button>
                </div>
            </div>
        `;
        loadAllianceChat();
    }
}

function getAllianceMissionProgress(reqType) {
    if (!game.stats) game.stats = { totalExpeditions: 0, totalZombiesKilled: 0, totalRepairs: 0 };
    if (reqType === 'allianceFood') return allianceStorage.food;
    if (reqType === 'allianceWood') return allianceStorage.wood;
    if (reqType === 'totalExpeditions') return game.stats.totalExpeditions;
    if (reqType === 'totalZombiesKilled') return game.stats.totalZombiesKilled;
    if (reqType === 'totalRepairs') return game.stats.totalRepairs;
    return 0;
}

window.openWarMapNodeModal = function(nodeId) {
    let node = warMapNodes.find(n => n.id === nodeId);
    if (!node) return;
    if (game.tier < 2) return log("❌ Akses War Map membutuhkan minimal Tier 2 (Pemukiman Berdikari)!");
    if (game.warMapActiveMission !== null) return log("❌ Tim Anda sedang dalam misi penjelajahan lain di War Map!");

    if (!game.nodeCooldowns) game.nodeCooldowns = {};
    let cooldownEnd = game.nodeCooldowns[nodeId] || 0;
    let now = Date.now();
    if (now < cooldownEnd) {
        let remainingSecs = Math.ceil((cooldownEnd - now) / 1000);
        return log(`⏳ Sektor ${node.name} masih dalam Cooldown pribadi! Sisa waktu: ${formatTimeHMS(remainingSecs)}`);
    }

    let isUnlocked = node.status === 'unlocked';
    let actionDesc = isUnlocked 
        ? `[ZONA FARMING: ${node.name}]\n⭐ Sektor ini dikuasai (bisa dipanen rutin).\n🎁 Hadiah Panen: ${node.rewardQty} ${node.rewardType.toUpperCase()}\n\nKirim tim panen (Durasi 5 Menit)?`
        : `[ZONA PENAKLUKAN: ${node.name}]\n⭐ Level Sektor: ${node.level}\n🎯 Target Poin: ${node.currentPoints} / ${node.targetPoints} Poin\n🎁 Hadiah Utama: ${node.rewardQty} ${node.rewardType.toUpperCase()}\n\nKirim tim gotong-royong (Durasi 5 Menit)?`;

    if (confirm(actionDesc)) {
        startWarMapExpedition(node.id);
    }
}

function startWarMapExpedition(nodeId) {
    game.warMapActiveMission = nodeId;
    game.warMapTimer = 300; 
    log(`🚀 [WAR MAP] Tim ekspedisi dikirim ke ${warMapNodes.find(n=>n.id===nodeId).name}. Estimasi kembali 5 menit.`);
    saveGameToCloud();
    renderPanel();
}

function finishWarMapExpedition() {
    let nodeId = game.warMapActiveMission;
    let node = warMapNodes.find(n => n.id === nodeId);
    game.warMapActiveMission = null;
    game.warMapTimer = 0;

    if (!game.nodeCooldowns) game.nodeCooldowns = {};
    game.nodeCooldowns[nodeId] = Date.now() + (3600 * 1000);

    let successChance = 0.65 + (game.wallLevel * 0.05) + (game.workers.wall * 0.03);
    let isSuccess = Math.random() < successChance;
    let cap = getStorageCap();

    if (isSuccess) {
        if (node.status === 'unlocked') {
            log(`🌾 [FARMING SUKSES] Berhasil memanen ${node.name}! +${node.rewardQty} ${node.rewardType.toUpperCase()}`);
            if(node.rewardType === 'food' || node.rewardType === 'wood') {
                game[node.rewardType] = Math.min(cap, (game[node.rewardType] || 0) + node.rewardQty);
            } else {
                game[node.rewardType] = (game[node.rewardType] || 0) + node.rewardQty;
            }
            allianceStorage[node.rewardType] = (allianceStorage[node.rewardType] || 0) + Math.floor(node.rewardQty / 2);
            set(ref(db, 'allianceStorage'), allianceStorage);
        } else {
            let earnedPoints = node.level * 25;
            node.currentPoints = Math.min(node.targetPoints, node.currentPoints + earnedPoints);
            log(`🏆 [WAR MAP SUKSES] Tim mencetak +${earnedPoints} Poin Kontribusi di ${node.name}! (${node.currentPoints}/${node.targetPoints})`);

            if (node.currentPoints >= node.targetPoints) {
                node.status = 'unlocked';
                log(`🎉 [SEKTOR DIKUASAI] Titik ${node.name} resmi dikuasai penuh oleh aliansi! Kini bisa dipanen berkala.`);
                if(node.rewardType === 'food' || node.rewardType === 'wood') {
                    game[node.rewardType] = Math.min(cap, (game[node.rewardType] || 0) + node.rewardQty);
                } else {
                    game[node.rewardType] = (game[node.rewardType] || 0) + node.rewardQty;
                }
                allianceStorage[node.rewardType] = (allianceStorage[node.rewardType] || 0) + Math.floor(node.rewardQty / 2);
                set(ref(db, 'allianceStorage'), allianceStorage);
            }
            set(ref(db, 'warMapNodes'), warMapNodes);
        }
    } else {
        log(`💀 [WAR MAP GAGAL] Tim dihadang gerombolan kuat di ${node.name} dan terpaksa mundur!`);
        let damage = Math.floor(Math.random() * 20) + 10;
        game.wallHealth = Math.max(0, game.wallHealth - damage);
        if (allianceStorage.food >= 15) {
            allianceStorage.food -= 15;
            log(`🛡️ [RISIKO BERSAMA] Lumbung Aliansi terpaksa mengorbankan 15kg beras untuk evakuasi.`);
            set(ref(db, 'allianceStorage'), allianceStorage);
        }
        log(`🚨 [SERANGAN BALIK] Kegagalan misi memicu serangan zombie! Benteng rusak -${damage}%!`);
    }

    updateUI();
    renderPanel();
    saveGameToCloud();
}

window.adjustWorker = function(type, direction) {
    let inputId = type === 'farm' ? 'inputAmountFarm' : 'inputAmountWall';
    let qty = parseInt(document.getElementById(inputId).value) || 1;

    if (direction > 0) {
        let available = getFreePop();
        let addQty = Math.min(qty, available);
        if (addQty <= 0) return log("Peringatan: Warga bebas tidak cukup!");
        game.workers[type] += addQty;
    } else {
        let subQty = Math.min(qty, game.workers[type]);
        game.workers[type] -= subQty;
    }
    updateUI();
    renderPanel();
    saveGameToCloud();
}

window.runExpedition = function(zone) {
    game.expeditionCooldown = 20;
    if (!game.stats) game.stats = { totalExpeditions: 0, totalZombiesKilled: 0, totalRepairs: 0 };
    game.stats.totalExpeditions++;
    let cap = getStorageCap();

    if (zone === 1) {
        let f = Math.floor(Math.random() * 20) + 15;
        let w = Math.floor(Math.random() * 6) + 3;
        game.food = Math.min(cap, game.food + f); 
        game.wood = Math.min(cap, game.wood + w);
        log(`🔎 [EKSPEDISI 1] Sukses! 🍚 +${f}kg Beras, 🪵 +${w} Kayu.`);
    } else if (zone === 2) {
        let f = Math.floor(Math.random() * 35) + 30;
        let w = Math.floor(Math.random() * 12) + 8;
        game.food = Math.min(cap, game.food + f); 
        game.wood = Math.min(cap, game.wood + w);
        log(`🔎 [EKSPEDISI 2] Sukses! 🍚 +${f}kg Beras, 🪵 +${w} Kayu.`);
    } else if (zone === 3) {
        game.food -= 20;
        let f = Math.floor(Math.random() * 60) + 60;
        let w = Math.floor(Math.random() * 25) + 20;
        game.food = Math.min(cap, game.food + f); 
        game.wood = Math.min(cap, game.wood + w);
        log(`🔎 [EKSPEDISI 3] Gudang Bulog! 🍚 +${f}kg Beras, 🪵 +${w} Kayu.`);
    }
    updateUI();
    renderPanel();
    saveGameToCloud();
}

function getMissionProgress(type) {
    if (type === 'food') return game.food;
    if (type === 'wood') return game.wood;
    if (type === 'pop') return game.pop;
    if (type === 'houseLevel') return game.houseLevel;
    if (type === 'wallLevel') return game.wallLevel;
    if (type === 'wallHealth') return game.wallHealth;
    if (type === 'tier') return game.tier;
    if (type === 'farmWorkers') return game.workers.farm;
    if (type === 'wallWorkers') return game.workers.wall;
    return 0;
}

window.claimMission = function() {
    let m = governmentMissions[game.currentMissionIndex];
    let cap = getStorageCap();
    game.wood = Math.min(cap, game.wood + m.rewardWood);
    log(`🎉 [MISI SELESAI] ${m.title}! Hadiah: 🪵 +${m.rewardWood} Kayu.`);
    game.currentMissionIndex++;
    updateUI();
    renderPanel();
    saveGameToCloud();
}

window.claimAllianceMission = function() {
    let am = allianceMissions[game.currentAllianceMissionIndex];
    let currentAllianceVal = getAllianceMissionProgress(am.reqType);

    if (currentAllianceVal >= am.reqValue) {
        let cap = getStorageCap();
        game.wood = Math.min(cap, game.wood + am.rewardWood);
        log(`🏆 [MISI ALIANSI SELESAI] ${am.title}! Bonus 🪵 +${am.rewardWood} Kayu.`);
        game.currentAllianceMissionIndex++;
        updateUI();
        renderPanel();
        saveGameToCloud();
    } else {
        log(`❌ Syarat progres misi aliansi belum tercapai.`);
    }
}

window.upgradeHouse = function() {
    let cost = game.houseLevel * 10;
    if (game.wood >= cost) {
        game.wood -= cost;
        game.houseLevel++;
        game.maxPop += 5;
        log(`🏠 [UPGRADE] Rumah ke Level ${game.houseLevel}! Kapasitas Warga: ${game.maxPop}, Lumbung meluas.`);
        updateUI(); renderPanel();
        saveGameToCloud();
    } else log(`Kayu kurang (Butuh 🪵 ${cost}).`);
}

window.upgradeWall = function() {
    let cost = game.wallLevel * 15;
    let metalReq = game.wallLevel >= 3 ? 10 : 0;
    if (game.wood >= cost && game.metal >= metalReq && game.wallLevel < 4) {
        game.wood -= cost;
        if (metalReq > 0) game.metal -= metalReq;
        game.wallLevel++;
        game.wallHealth = 100;
        log(`🛡️ [UPGRADE] Benteng ditingkatkan ke Level ${game.wallLevel}!`);
        updateUI(); renderPanel();
        saveGameToCloud();
    } else log("Gagal upgrade benteng (Cek Kayu / Logam).");
}

window.repairWallCustom = function() {
    let qty = parseInt(document.getElementById('inputRepairAmount').value) || 1;
    let totalCost = qty * 5;
    if (game.wood >= totalCost) {
        if (game.wallHealth >= 100) return log("Benteng sudah 100% utuh.");
        game.wood -= totalCost;
        game.wallHealth = Math.min(100, game.wallHealth + (qty * 25));
        if (!game.stats) game.stats = { totalExpeditions: 0, totalZombiesKilled: 0, totalRepairs: 0 };
        game.stats.totalRepairs++;
        log(`🔨 [PERBAIKAN] Memperbaiki benteng sebanyak ${qty} tahap (-🪵 ${totalCost} Kayu).`);
        updateUI(); renderPanel();
        saveGameToCloud();
    } else log(`Kayu tidak cukup (Butuh 🪵 ${totalCost}).`);
}

function syncAllianceStorage() {
    let allianceRef = ref(db, 'allianceStorage');
    onValue(allianceRef, (snapshot) => {
        if (snapshot.exists()) {
            allianceStorage = snapshot.val();
        } else {
            set(allianceRef, { food: 0, wood: 0, metal: 0, chemicals: 0 });
        }
        if (currentTab === 'coop') renderPanel();
    });
}

window.donateToAlliance = function() {
    let type = document.getElementById('donateType').value;
    let qty = parseInt(document.getElementById('donateQty').value) || 20;

    if (game[type] < qty) return log(`❌ Stok ${type} pribadi tidak cukup untuk didonasikan!`);

    game[type] -= qty;
    allianceStorage[type] += qty;
    set(ref(db, 'allianceStorage'), allianceStorage);

    let chatRef = ref(db, 'allianceChat');
    push(chatRef, {
        sender: currentUserEmail.split('@')[0],
        message: `📦 [DONASI] Menyumbangkan ${qty} ${type} ke Lumbung Aliansi!`,
        time: Date.now()
    });

    updateUI();
    renderPanel();
    saveGameToCloud();
    log(`📦 Berhasil mendonasikan ${qty} ${type} ke Aliansi.`);
}

window.sendAllianceChat = function() {
    let msgInput = document.getElementById('chatInputMsg');
    if (!msgInput) return;
    let text = msgInput.value.trim();
    if(!text) return;

    let chatRef = ref(db, 'allianceChat');
    push(chatRef, {
        sender: currentUserEmail.split('@')[0],
        message: text,
        time: Date.now()
    });
    msgInput.value = "";
}

window.handleChatKeyPress = function(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        window.sendAllianceChat();
    }
}

function loadAllianceChat() {
    let chatRef = ref(db, 'allianceChat');
    onValue(chatRef, (snapshot) => {
        let chatBox = document.getElementById('coopChatBox');
        if(!chatBox) return;
        chatBox.innerHTML = "";
        snapshot.forEach((childSnapshot) => {
            let data = childSnapshot.val();
            chatBox.innerHTML += `<div><b>[${data.sender}]</b>: ${data.message}</div>`;
        });
        chatBox.scrollTop = chatBox.scrollHeight;
    });
}

function updateUI() {
    checkTierProgression();

    let fText = document.getElementById('foodText');
    if(fText) fText.innerText = `🍚 ${game.food} kg`;
    
    let netRate = ((game.workers.farm * 6) + 5) - (game.pop * 2);
    let fRate = document.getElementById('foodRateText');
    if(fRate) fRate.innerText = `(${netRate >= 0 ? '+' : ''}${netRate}/30s)`;

    let pText = document.getElementById('popText');
    if(pText) pText.innerText = `👥 ${game.pop} / ${game.maxPop}`;

    let fpText = document.getElementById('freePopText');
    if(fpText) fpText.innerText = `Bebas: ${getFreePop()}`;

    let wText = document.getElementById('wallText');
    if(wText) wText.innerText = `🛡️ ${game.wallHealth}%`;

    let woodText = document.getElementById('woodText');
    if(woodText) woodText.innerText = `${game.wood}`;

    let metalText = document.getElementById('metalText');
    if(metalText) metalText.innerText = `${game.metal || 0}`;

    let chemText = document.getElementById('chemText');
    if(chemText) chemText.innerText = `${game.chemicals || 0}`;

    let tierNames = ["Tier 1: Desa Darurat", "Tier 2: Pemukiman Berdikari", "Tier 3: Zona Aman Mandiri"];
    let tierText = document.getElementById('tierText');
    if(tierText) tierText.innerText = tierNames[game.tier - 1];

    let sectorLight = document.getElementById('sectorStatusLight');
    if (sectorLight) {
        sectorLight.className = "status-light";
        if (game.wallHealth <= 30) sectorLight.classList.add('danger');
        else if (game.wallHealth <= 60) sectorLight.classList.add('warning');
    }

    if (game.wallHealth <= 30) {
        document.body.style.boxShadow = "inset 0 0 60px rgba(248, 113, 113, 0.65)";
    } else {
        document.body.style.boxShadow = "none";
    }
}

setInterval(() => {
    if(!currentUserEmail) return;

    if (game.expeditionCooldown > 0) {
        game.expeditionCooldown--;
        if (currentTab === 'expedition') renderPanel();
    }

    if (game.warMapActiveMission !== null) {
        if (typeof game.warMapTimer !== 'number' || isNaN(game.warMapTimer)) game.warMapTimer = 300;
        game.warMapTimer--;
        let countdownDisplay = document.getElementById('warMapCountdownDisplay');
        if (countdownDisplay) countdownDisplay.innerText = formatTimeHMS(game.warMapTimer);

        if (game.warMapTimer <= 0) finishWarMapExpedition();
    }

    game.timers.event--;
    if (game.timers.event <= 0) {
        triggerRandomEvent();
        game.timers.event = 180;
    }

    game.timers.production--;
    if (game.timers.production <= 0) {
        let freePop = getFreePop();
        let consumption = game.pop * 2;
        let production = (game.workers.farm * 6) + 5;
        let netFood = production - consumption;
        let cap = getStorageCap();
        
        game.food = Math.min(cap, Math.max(0, game.food + netFood));

        let woodScavenged = 0;
        if (freePop > 0) {
            let baseRandomPerPerson = Math.floor(Math.random() * 2) + 1;
            woodScavenged = freePop * baseRandomPerPerson;
            if (Math.random() < 0.20) {
                let bonusWood = Math.floor(Math.random() * 5) + 2;
                woodScavenged += bonusWood;
                log(`🪵 [PEMULUNG] Warga menemukan reruntuhan utuh! Bonus +${bonusWood} Kayu.`);
            }
        }
        game.wood = Math.min(cap, game.wood + woodScavenged);

        log(`🌾 [PRODUKSI] Panen +${production}kg, Konsumsi -${consumption}kg.`);
        if (woodScavenged > 0) log(`🪵 [PEMULUNG] Warga bebas mengumpulkan total +${woodScavenged} Kayu.`);

        if (game.pop < game.maxPop && game.food >= 50 && Math.random() < 0.35) {
            game.pop++;
            log(`👥 [PENGUNGSI] Seorang penyintas baru datang meminta suaka! Populasi kini ${game.pop}.`);
        }

        game.timers.production = 30;
        updateUI();
        saveGameToCloud();
    }

    game.timers.zombie--;
    if (game.timers.zombie === 119) {
        let randThreat = Math.random();
        if (randThreat < 0.25) nextZombieThreat = "Tank 🦣";
        else if (randThreat < 0.50) nextZombieThreat = "Penyusup 🥷";
        else nextZombieThreat = "Standar 🧟";
    }

    let zTimer = document.getElementById('zombieTimerText');
    if(zTimer) zTimer.innerText = `Zombie [${nextZombieThreat}]: ${game.timers.zombie}s`;
    
    if (game.timers.zombie <= 0) {
        triggerFullGlitchAndSound('zombie_attack');

        if (nextZombieThreat.includes("Tank")) {
            log("🚨 [ZOMBIE TANK] Gerombolan monster besar menyeruduk keras benteng!");
            let baseDamage = Math.floor(Math.random() * 25) + 35;
            let wallDefense = (game.wallLevel * 5) + (game.workers.wall * 8);
            let finalDamage = Math.max(10, baseDamage - wallDefense);

            game.wallHealth -= finalDamage;
            log(`💥 Benteng hancur parah akibat hantaman Tank (-${finalDamage}%).`);

            if (game.wallHealth <= 0 && game.houseLevel > 1) {
                game.houseLevel--;
                log(`💥 [DE-UPGRADE] Hantaman Tank meruntuhkan Rumah warga turun ke Level ${game.houseLevel}!`);
            }
        } 
        else if (nextZombieThreat.includes("Penyusup") && game.workers.wall < 2) {
            if (game.pop > 1) {
                game.pop--;
                log(`🥷 [ZOMBIE PENYUSUP] Penjagaan longgar! Penyusup menyelinap dan menculik 1 warga ke zona luar!`);
            } else {
                let stolenFood = Math.floor(Math.random() * 25) + 15;
                game.food = Math.max(0, game.food - stolenFood);
                log(`🥷 [ZOMBIE PENYUSUP] Penyusup mencuri 🍚 ${stolenFood}kg Beras!`);
            }
        } 
        else {
            log("🚨 [ZOMBIE] Gelombang mayat hidup standar menyerbu pos penjagaan!");
            let baseDamage = Math.floor(Math.random() * 20) + 15;
            let wallDefense = (game.wallLevel * 5) + (game.workers.wall * 8);
            let finalDamage = Math.max(5, baseDamage - wallDefense);
            game.wallHealth -= finalDamage;
            log(`🛡️ Benteng berhasil menahan serangan (-${finalDamage}%).`);
        }

        if (game.wallHealth <= 0) {
            game.wallHealth = 0;
            let casualty = Math.floor(Math.random() * 2) + 1;
            game.pop = Math.max(1, game.pop - casualty);
            log(`💀 [BENTENG JEBOL] Benteng runtuh total! ${casualty} warga gugur diserang.`);
        }

        if (!game.stats) game.stats = { totalExpeditions: 0, totalZombiesKilled: 0, totalRepairs: 0 };
        game.stats.totalZombiesKilled++;

        game.timers.zombie = 120;
        updateUI();
        saveGameToCloud();
    }
}, 1000);