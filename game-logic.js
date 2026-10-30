// game-logic.js - Mesin Utama Simulasi Desa & Integrasi Firebase Auth
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

// State Game Utama
let game = {
    food: 100,
    wood: 15,
    pop: 5,
    maxPop: 5,
    houseLevel: 1,
    wallHealth: 100,
    wallLevel: 1,
    tier: 1,
    workers: { farm: 0, wall: 0 },
    timers: { production: 30, zombie: 120, event: 90 },
    currentMissionIndex: 0,
    expeditionCooldown: 0
};

let currentTab = 'village';
let currentUserEmail = "";

// --- SISTEM AUTH & LOGIN FIREBASE ---
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
    await signOut(auth);
}

// Pantau Status Auth Pengguna
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUserEmail = user.email;
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('gameMainUI').style.display = 'flex';
        log(`[SISTEM] Masuk sebagai: ${currentUserEmail}`);
        renderPanel();
        updateUI();
    } else {
        currentUserEmail = "";
        document.getElementById('authScreen').style.display = 'flex';
        document.getElementById('gameMainUI').style.display = 'none';
    }
});

// --- DAFTAR 20 MISI PEMERINTAH ---
const governmentMissions = [
    { title: "Misi 01: Pasokan Beras Pertama", reqType: "food", reqValue: 120, rewardWood: 10, desc: "Kumpulkan total 120 kg beras di gudang." },
    { title: "Misi 02: Pagar Bambu Pertama", reqType: "wallHealth", reqValue: 100, rewardWood: 15, desc: "Pastikan benteng dalam kondisi 100% utuh." },
    { title: "Misi 03: Penampungan Pengungsi", reqType: "pop", reqValue: 7, rewardWood: 20, desc: "Tampung minimal 7 warga di dalam desa." },
    { title: "Misi 04: Pasokan Pangan Darurat", reqType: "food", reqValue: 180, rewardWood: 20, desc: "Amankan cadangan beras hingga 180 kg." },
    { title: "Misi 05: Upgrade Rumah Level 2", reqType: "houseLevel", reqValue: 2, rewardWood: 25, desc: "Tingkatkan fasilitas rumah warga ke Level 2." },
    { title: "Misi 06: Naik ke Tier 2 (Berdikari)", reqType: "tier", reqValue: 2, rewardWood: 30, desc: "Rebut status Tier 2 (Min. 10 Warga & Benteng Lv. 2)." },
    { title: "Misi 07: Skuad Penjaga Pos Ronda", reqType: "wallWorkers", reqValue: 3, rewardWood: 25, desc: "Tugaskan minimal 3 penjaga di pos benteng." },
    { title: "Misi 08: Lumbung Pangan Mandiri", reqType: "food", reqValue: 250, rewardWood: 30, desc: "Kumpulkan 250 kg beras untuk cadangan kemarau." },
    { title: "Misi 09: Material Gudang Kayu", reqType: "wood", reqValue: 50, rewardWood: 35, desc: "Kumpulkan cadangan 50 unit kayu di penyimpanan." },
    { title: "Misi 10: Pemukiman 12 Warga", reqType: "pop", reqValue: 12, rewardWood: 40, desc: "Perluas populasi desa hingga mencapai 12 warga." },
    { title: "Misi 11: Benteng Pertahanan Level 3", reqType: "wallLevel", reqValue: 3, rewardWood: 45, desc: "Perkuat struktur benteng hingga Level 3." },
    { title: "Misi 12: Pertanian Intensif", reqType: "farmWorkers", reqValue: 4, rewardWood: 40, desc: "Tugaskan minimal 4 pekerja penuh waktu di kebun." },
    { title: "Misi 13: Pasokan Pangan Besar", reqType: "food", reqValue: 350, rewardWood: 50, desc: "Capai stok 350 kg beras untuk suplai distrik." },
    { title: "Misi 14: Upgrade Rumah Level 3", reqType: "houseLevel", reqValue: 3, rewardWood: 50, desc: "Tingkatkan rumah warga ke Level 3." },
    { title: "Misi 15: Komunitas 16 Warga", reqType: "pop", reqValue: 16, rewardWood: 60, desc: "Tampung dan rawat total 16 warga penyintas." },
    { title: "Misi 16: Stok Kayu Melimpah", reqType: "wood", reqValue: 80, rewardWood: 60, desc: "Miliki simpanan 80 unit kayu di markas." },
    { title: "Misi 17: Persiapan Kota Benteng", reqType: "wallLevel", reqValue: 4, rewardWood: 70, desc: "Tingkatkan benteng pertahanan ke Level Maksimal (4)." },
    { title: "Misi 18: Cadangan Beras Utama", reqType: "food", reqValue: 500, rewardWood: 80, desc: "Kumpulkan 500 kg beras sebagai cadangan utama." },
    { title: "Misi 19: Capai Tier 3 (Zona Aman)", reqType: "tier", reqValue: 3, rewardWood: 100, desc: "Buka status Tier 3: Zona Aman Mandiri (20 Warga)." },
    { title: "Misi 20: Puncak Kedamaian Nusantara", reqType: "pop", reqValue: 20, rewardWood: 200, desc: "Pertahankan 20 warga dan selamatkan desa secara penuh!" }
];

function log(msg) {
    let t = document.getElementById('terminalLog');
    if(t) {
        t.innerHTML += `<br>> ${msg}`;
        t.scrollTop = t.scrollHeight;
    }
}

function getFreePop() {
    return game.pop - (game.workers.farm + game.workers.wall);
}

window.switchTab = function(tabName, element) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    element.classList.add('active');
    currentTab = tabName;
    renderPanel();
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

// --- RENDER PANEL ANTARMUKA (DENGAN INPUT AMOUNT) ---
function renderPanel() {
    let panel = document.getElementById('mainPanel');
    if(!panel) return;
    panel.innerHTML = '';

    if (currentTab === 'village') {
        panel.innerHTML = `<div class="section-title">Alokasi Tenaga Kerja Warga</div>`;
        panel.innerHTML += `
            <div class="card-box">
                <div class="card-header">
                    <h5>🌾 Kebun Pangan Desa</h5>
                    <span>${game.workers.farm} Pekerja</span>
                </div>
                <div class="card-desc">Tiap pekerja menambah +6kg beras per 30 detik.</div>
                <div class="worker-controls">
                    <button class="btn-ctrl" onclick="adjustWorker('farm', -1)">-</button>
                    <input type="number" id="inputAmountFarm" class="input-amount" value="1" min="1">
                    <button class="btn-ctrl" onclick="adjustWorker('farm', 1)">+</button>
                </div>
            </div>

            <div class="card-box">
                <div class="card-header">
                    <h5>🛡️ Pos Benteng Penjagaan</h5>
                    <span>${game.workers.wall} Penjaga</span>
                </div>
                <div class="card-desc">Mengurangi kerusakan benteng saat serangan zombie.</div>
                <div class="worker-controls">
                    <button class="btn-ctrl" onclick="adjustWorker('wall', -1)">-</button>
                    <input type="number" id="inputAmountWall" class="input-amount" value="1" min="1">
                    <button class="btn-ctrl" onclick="adjustWorker('wall', 1)">+</button>
                </div>
            </div>

            <div class="card-box">
                <div class="card-header">
                    <h5>🪵 Patroli & Pemulung Kayu</h5>
                    <span style="color:#a1a1aa;">${getFreePop()} Warga Bebas</span>
                </div>
                <div class="card-desc">Mencari Kayu otomatis per 30s & menekan risiko pencurian.</div>
            </div>
        `;
    } else if (currentTab === 'expedition') {
        panel.innerHTML = `<div class="section-title">Ekspedisi Bertingkat Luar Desa</div>`;
        
        panel.innerHTML += `
            <div class="card-box">
                <div class="card-header">
                    <h5>📍 Zona 1: Pinggiran Perumahan</h5>
                    <span style="color:#34d399;">Terbuka</span>
                </div>
                <div class="card-desc">Hasil: Beras & Kayu Kecil (Cooldown: 20s).</div>
                <button class="btn-action" ${game.expeditionCooldown > 0 ? 'disabled' : ''} onclick="runExpedition(1)">
                    ${game.expeditionCooldown > 0 ? `Tunggu (${game.expeditionCooldown}s)` : 'Kirim Tim'}
                </button>
            </div>
        `;

        let z2Unlocked = game.tier >= 2 && game.workers.wall >= 2;
        panel.innerHTML += `
            <div class="card-box">
                <div class="card-header">
                    <h5>📍 Zona 2: Pertokoan & Apotek</h5>
                    <span style="color:${z2Unlocked ? '#34d399' : '#f87171'};">${z2Unlocked ? 'Terbuka' : 'Terkunci (Tier 2 & 2 Penjaga)'}</span>
                </div>
                <div class="card-desc">Hasil: Beras Melimpah & Kayu Bagus.</div>
                <button class="btn-action" ${!z2Unlocked || game.expeditionCooldown > 0 ? 'disabled' : ''} onclick="runExpedition(2)">
                    ${game.expeditionCooldown > 0 ? `Tunggu (${game.expeditionCooldown}s)` : 'Kirim Tim'}
                </button>
            </div>
        `;

        let z3Unlocked = game.tier >= 3 && game.food >= 150;
        panel.innerHTML += `
            <div class="card-box">
                <div class="card-header">
                    <h5>📍 Zona 3: Gudang Bulog</h5>
                    <span style="color:${z3Unlocked ? '#34d399' : '#f87171'};">${z3Unlocked ? 'Terbuka' : 'Terkunci (Tier 3 & 150kg Beras)'}</span>
                </div>
                <div class="card-desc">Bekal: 20kg Beras. Hasil: Kayu Raksasa & Logistik Super.</div>
                <button class="btn-action" ${!z3Unlocked || game.expeditionCooldown > 0 ? 'disabled' : ''} onclick="runExpedition(3)">
                    ${game.expeditionCooldown > 0 ? `Tunggu (${game.expeditionCooldown}s)` : 'Kirim Tim Taktis'}
                </button>
            </div>
        `;
    } else if (currentTab === 'missions') {
        panel.innerHTML = `<div class="section-title">Papan Misi Operasi Pemerintah</div>`;
        if (game.currentMissionIndex < governmentMissions.length) {
            let m = governmentMissions[game.currentMissionIndex];
            let currentVal = getMissionProgress(m.reqType);
            let isReady = currentVal >= m.reqValue;

            panel.innerHTML += `
                <div class="card-box">
                    <div class="card-header">
                        <h5>${m.title}</h5>
                        <span>Misi ${game.currentMissionIndex + 1} / 20</span>
                    </div>
                    <div class="card-desc">${m.desc}</div>
                    <div style="font-size:9px; color:#fbbf24; margin:4px 0;">Progres: <b>${currentVal} / ${m.reqValue}</b></div>
                    <button class="btn-action" style="background:${isReady ? '#047857' : '#374151'};" ${!isReady ? 'disabled' : ''} onclick="claimMission()">
                        ${isReady ? 'Klaim Hadiah (🪵 ' + m.rewardWood + ' Kayu)' : 'Belum Selesai'}
                    </button>
                </div>
            `;
        } else {
            panel.innerHTML += `<div class="card-box"><p style="font-size:10px; color:#34d399;">🏆 Seluruh 20 Misi Pemerintah Selesai!</p></div>`;
        }
    } else if (currentTab === 'upgrade') {
        panel.innerHTML = `<div class="section-title">Pembangunan & Struktur Desa</div>`;
        
        let houseCost = game.houseLevel * 10;
        panel.innerHTML += `
            <div class="card-box">
                <div class="card-header">
                    <h5>🏠 Upgrade Rumah (Lv. ${game.houseLevel})</h5>
                </div>
                <div class="card-desc">+5 Kapasitas Warga. Biaya: 🪵 ${houseCost} Kayu.</div>
                <button class="btn-action" onclick="upgradeHouse()">Upgrade Rumah</button>
            </div>
        `;

        let wallCost = game.wallLevel * 15;
        panel.innerHTML += `
            <div class="card-box">
                <div class="card-header">
                    <h5>🛡️ Upgrade Benteng (Lv. ${game.wallLevel})</h5>
                </div>
                <div class="card-desc">Meningkatkan pertahanan. Biaya: 🪵 ${wallCost} Kayu.</div>
                <button class="btn-action" style="background:#0284c7;" ${game.wallLevel >= 4 ? 'disabled' : ''} onclick="upgradeWall()">
                    ${game.wallLevel >= 4 ? 'Maksimal (Lv. 4)' : 'Upgrade Benteng'}
                </button>
            </div>
        `;

        panel.innerHTML += `
            <div class="card-box">
                <div class="card-header">
                    <h5>🔨 Perbaiki Benteng</h5>
                </div>
                <div class="card-desc">Memulihkan +25% Ketahanan (Biaya: 🪵 5 Kayu per klik, atau ketik jumlah).</div>
                <div class="worker-controls" style="margin-top:4px;">
                    <input type="number" id="inputRepairAmount" class="input-amount" value="1" min="1" style="width:60px;">
                    <button class="btn-action" style="background:#d97706; width:auto; padding:4px 10px;" onclick="repairWallCustom()">Perbaiki</button>
                </div>
            </div>
        `;
    } else if (currentTab === 'coop') {
        panel.innerHTML = `<div class="section-title">Aliansi Co-op & Chat Desa</div>`;
        panel.innerHTML += `
            <div class="card-box">
                <div class="card-header"><h5>💬 Aliansi Chat & Logistik</h5></div>
                <div class="card-desc">Fitur Co-op real-time terhubung via Firebase aktif. Sapa ketua desa lain!</div>
                <div id="coopChatBox" class="chat-box">[SISTEM] Terhubung ke Aliansi...</div>
                <div style="display:flex; gap:4px; margin-top:4px;">
                    <input type="text" id="chatInputMsg" class="input-field" placeholder="Ketik pesan..." style="flex-grow:1; padding:6px;">
                    <button class="btn-action" style="width:60px;" onclick="sendAllianceChat()">Kirim</button>
                </div>
            </div>
        `;
        loadAllianceChat();
    }
}

window.adjustWorker = function(type, direction) {
    let inputId = type === 'farm' ? 'inputAmountFarm' : 'inputAmountWall';
    let qty = parseInt(document.getElementById(inputId).value) || 1;

    if (direction > 0) {
        let available = getFreePop();
        let addQty = Math.min(qty, available);
        if (addQty <= 0) {
            log("Peringatan: Warga bebas tidak cukup!");
            return;
        }
        game.workers[type] += addQty;
    } else {
        let subQty = Math.min(qty, game.workers[type]);
        game.workers[type] -= subQty;
    }
    updateUI();
    renderPanel();
}

window.runExpedition = function(zone) {
    game.expeditionCooldown = 20;
    if (zone === 1) {
        let f = Math.floor(Math.random() * 20) + 15;
        let w = Math.floor(Math.random() * 6) + 3;
        game.food += f; game.wood += w;
        log(`🔎 [EKSPEDISI 1] Sukses! 🍚 +${f}kg Beras, 🪵 +${w} Kayu.`);
    } else if (zone === 2) {
        let f = Math.floor(Math.random() * 35) + 30;
        let w = Math.floor(Math.random() * 12) + 8;
        game.food += f; game.wood += w;
        log(`🔎 [EKSPEDISI 2] Sukses! 🍚 +${f}kg Beras, 🪵 +${w} Kayu.`);
    } else if (zone === 3) {
        game.food -= 20;
        let f = Math.floor(Math.random() * 60) + 60;
        let w = Math.floor(Math.random() * 25) + 20;
        game.food += f; game.wood += w;
        log(`🔎 [EKSPEDISI 3] Berhasil merangsek Gudang Bulog! 🍚 +${f}kg Beras, 🪵 +${w} Kayu.`);
    }
    updateUI();
    renderPanel();
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
    game.wood += m.rewardWood;
    log(`🎉 [MISI SELESAI] ${m.title}! Hadiah: 🪵 +${m.rewardWood} Kayu.`);
    game.currentMissionIndex++;
    updateUI();
    renderPanel();
}

window.upgradeHouse = function() {
    let cost = game.houseLevel * 10;
    if (game.wood >= cost) {
        game.wood -= cost;
        game.houseLevel++;
        game.maxPop += 5;
        log(`🏠 [UPGRADE] Rumah ke Level ${game.houseLevel}! Kapasitas: ${game.maxPop}.`);
        updateUI(); renderPanel();
    } else log(`Kayu kurang (Butuh 🪵 ${cost}).`);
}

window.upgradeWall = function() {
    let cost = game.wallLevel * 15;
    if (game.wood >= cost && game.wallLevel < 4) {
        game.wood -= cost;
        game.wallLevel++;
        game.wallHealth = 100;
        log(`🛡️ [UPGRADE] Benteng ditingkatkan ke Level ${game.wallLevel}!`);
        updateUI(); renderPanel();
    } else log("Gagal upgrade benteng.");
}

window.repairWallCustom = function() {
    let qty = parseInt(document.getElementById('inputRepairAmount').value) || 1;
    let totalCost = qty * 5;
    if (game.wood >= totalCost) {
        if (game.wallHealth >= 100) return log("Benteng sudah 100% utuh.");
        game.wood -= totalCost;
        game.wallHealth = Math.min(100, game.wallHealth + (qty * 25));
        log(`🔨 [PERBAIKAN] Memperbaiki benteng sebanyak ${qty} tahap (-🪵 ${totalCost} Kayu).`);
        updateUI(); renderPanel();
    } else log(`Kayu tidak cukup untuk ${qty} tahap perbaikan (Butuh 🪵 ${totalCost}).`);
}

// --- FITUR CO-OP CHAT FIREBASE ---
window.sendAllianceChat = function() {
    let msgInput = document.getElementById('chatInputMsg');
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
    if(woodText) woodText.innerText = `${game.wood} Unit`;

    let tierNames = ["Tier 1: Desa Darurat", "Tier 2: Pemukiman Berdikari", "Tier 3: Zona Aman Mandiri"];
    let tierText = document.getElementById('tierText');
    if(tierText) tierText.innerText = tierNames[game.tier - 1];
}

// --- GAME LOOP UTAMA ---
setInterval(() => {
    if(!currentUserEmail) return;

    if (game.expeditionCooldown > 0) {
        game.expeditionCooldown--;
        if (currentTab === 'expedition') renderPanel();
    }

    game.timers.production--;
    if (game.timers.production <= 0) {
        let freePop = getFreePop();
        let consumption = game.pop * 2;
        let production = (game.workers.farm * 6) + 5;
        let netFood = production - consumption;
        game.food += netFood;

        let woodScavenged = Math.floor(freePop * 1.5);
        game.wood += woodScavenged;

        log(`🌾 [PRODUKSI] Panen +${production}kg, Konsumsi -${consumption}kg.`);
        if (woodScavenged > 0) log(`🪵 [PEMULUNG] Warga bebas mengumpulkan +${woodScavenged} Kayu.`);

        if (game.food < 0) game.food = 0;
        game.timers.production = 30;
        updateUI();
    }

    game.timers.zombie--;
    let zTimer = document.getElementById('zombieTimerText');
    if(zTimer) zTimer.innerText = `Zombie: ${game.timers.zombie}s`;
    
    if (game.timers.zombie <= 0) {
        log("🚨 [ZOMBIE] Gerombolan zombie menyerbu pos penjagaan!");
        let baseDamage = Math.floor(Math.random() * 20) + 20;
        let wallDefense = (game.wallLevel * 5) + (game.workers.wall * 8);
        let finalDamage = Math.max(5, baseDamage - wallDefense);

        game.wallHealth -= finalDamage;
        if (game.wallHealth <= 0) {
            game.wallHealth = 0;
            let casualty = 1;
            game.pop = Math.max(1, game.pop - casualty);
            log(`💀 [BENTENG JEBOL] ${casualty} warga gugur!`);
        } else {
            log(`🛡️ Benteng menahan serangan (-${finalDamage}%).`);
        }
        game.timers.zombie = 120;
        updateUI();
    }
}, 1000);
