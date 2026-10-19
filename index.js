const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const readline = require('readline');

// ==========================================
// KONFIGURASI BOT & HARGA VOUCHER SUPER WIFI
// ==========================================
const ADMIN_NUMBER = '6283133882711'; 
const BOT_NUMBER = '6283133882711'; 

// Stok Kode Voucher Wi-Fi Sesuai Paket
const stokVoucher = {
    '1': ['3JAM-ABC12', '3JAM-XYZ34'],
    '2': ['7JAM-QWE78', '7JAM-RTY90'],
    '3': ['10JAM-UIO12', '10JAM-PAS34'],
    '4': ['36JAM-ZXC56', '36JAM-VBN78']
};

const qrisGambar = {
    '1': './qris1.jpeg',
    '2': './qris2.jpeg',
    '3': './qris3.jpeg',
    '4': './qris4.jpeg'
};

const transaksiPending = {};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false
    });

    if (!sock.authState.creds.registered) {
        let phoneNumber = BOT_NUMBER;
        if (!phoneNumber) {
            phoneNumber = await question('Masukkan nomor WhatsApp Bot Anda (Contoh 628xxx): ');
        }
        phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
        
        setTimeout(async () => {
            try {
                if (!sock.authState.creds.registered) {
                    const code = await sock.requestPairingCode(phoneNumber);
                    console.log(`\n🔑 KODE PAIRING WHATSAPP KAMU: ${code?.match(/.{1,4}/g)?.join('-') || code}\n`);
                }
            } catch (err) {
                console.error('Gagal meminta kode pairing:', err);
            }
        }, 15000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ Bot Super Wifi Siap Digunakan!');
        }
    });

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        const m = chatUpdate.messages[0];
        if (!m.message) return;

        const from = m.key.remoteJid;
        
        let senderNumber = from ? from.split('@')[0] : '';
        if (m.key.participant) {
            senderNumber = m.key.participant.split('@')[0];
        }
        if (senderNumber.length > 15 && m.pushName) {
            senderNumber = m.pushName;
        }

        const body = m.message.conversation || m.message.extendedTextMessage?.text || '';
        const text = body.trim();

        console.log(`[LOG] Dari: ${senderNumber} | Teks: "${text}" | fromMe: ${m.key.fromMe}`);

        const isAdminAction = m.key.fromMe;

        if (isAdminAction) {
            const lowerText = text.toLowerCase().replace(/\s+/g, ''); // Hapus spasi (misal "siap 1" jadi "siap1")

            // 1. Eksekusi SIAP (ACC)
            if (lowerText.startsWith('siap')) {
                const indexStr = lowerText.replace('siap', '');
                const index = indexStr ? parseInt(indexStr) - 1 : 0; // Default ke-0 (urutan 1) jika hanya ketik "siap"

                const listPending = Object.values(transaksiPending);
                listPending.sort((a, b) => a.timestamp - b.timestamp);

                if (listPending.length === 0) {
                    await sock.sendMessage(from, { text: '⚠️ Tidak ada transaksi pending saat ini.' });
                    return;
                }

                if (isNaN(index) || index < 0 || index >= listPending.length) {
                    await sock.sendMessage(from, { 
                        text: `⚠️ Urutan antrean tidak ditemukan!\nSaat ini hanya ada ${listPending.length} transaksi pending.` 
                    });
                    return;
                }

                const currentTrx = listPending[index];
                const targetNum = currentTrx.jId;
                const paketId = currentTrx.paket;

                const daftarHargaNama = { 
                    '1': '3 Jam (Rp 1.000)', 
                    '2': '7 Jam (Rp 2.000)', 
                    '3': '10 Jam (Rp 3.000)', 
                    '4': '36 Jam (Rp 5.000)' 
                };
                const namaPaket = daftarHargaNama[paketId];

                if (stokVoucher[paketId] && stokVoucher[paketId].length > 0) {
                    const kodeVoucher = stokVoucher[paketId].shift();

                    // Kirim voucher ke pembeli
                    await sock.sendMessage(targetNum, {
                        text: `🎉 *PEMBAYARAN DITERIMA!*\n\n` +
                            `Berikut adalah Kode Voucher Super Wifi Anda:\n` +
                            `🔑 Kode: *${kodeVoucher}*\n\n` +
                            `Silakan masukkan kode tersebut di halaman login Wi-Fi. Terima kasih!`
                    });

                    // Konfirmasi ke admin
                    await sock.sendMessage(from, { 
                        text: `✅ Berhasil ACC pesanan antrean #${index + 1} (*${namaPaket}*)\nKode terkirim: *${kodeVoucher}*\nSisa stok: ${stokVoucher[paketId].length}` 
                    });

                    clearTimeout(currentTrx.timeout);
                    delete transaksiPending[targetNum];
                } else {
                    await sock.sendMessage(from, { text: `⚠️ Stok voucher untuk paket ${namaPaket} HABIS!` });
                }
                return;
            }

            // 2. Eksekusi CANCEL (BATAL)
            if (lowerText.startsWith('cancel')) {
                const indexStr = lowerText.replace('cancel', '');
                const index = indexStr ? parseInt(indexStr) - 1 : 0;

                const listPending = Object.values(transaksiPending);
                listPending.sort((a, b) => a.timestamp - b.timestamp);

                if (listPending.length === 0) {
                    await sock.sendMessage(from, { text: '⚠️ Tidak ada transaksi pending untuk dibatalkan.' });
                    return;
                }

                if (isNaN(index) || index < 0 || index >= listPending.length) {
                    await sock.sendMessage(from, { 
                        text: `⚠️ Urutan antrean tidak ditemukan!\nSaat ini hanya ada ${listPending.length} transaksi pending.` 
                    });
                    return;
                }

                const currentTrx = listPending[index];
                const targetNum = currentTrx.jId;
                const paketId = currentTrx.paket;

                const daftarHargaNama = { 
                    '1': '3 Jam (Rp 1.000)', 
                    '2': '7 Jam (Rp 2.000)', 
                    '3': '10 Jam (Rp 3.000)', 
                    '4': '36 Jam (Rp 5.000)' 
                };
                const namaPaket = daftarHargaNama[paketId];

                await sock.sendMessage(targetNum, {
                    text: `❌ *TRANSAKSI DIBATALKAN*\n\n` +
                        `Mohon maaf, transaksi untuk *${namaPaket}* dibatalkan oleh Admin.\n\n` +
                        `Silakan ketik *pesan* jika ingin memesan ulang.`
                });

                await sock.sendMessage(from, { 
                    text: `❌ Berhasil membatalkan pesanan antrean #${index + 1} (*${namaPaket}*)` 
                });

                clearTimeout(currentTrx.timeout);
                delete transaksiPending[targetNum];
                return;
            }
            return;
        }

        // ================= LOGIKA PEMBELI =================
        if (text.toLowerCase() === 'menu' || text.toLowerCase() === 'ping' || text === '0' || text.toLowerCase() === 'beli' || text.toLowerCase() === 'pesan') {
            const menuText = `=== 📶 SUPER WIFI - LOGIN ===\n\n` +
                `Silakan pilih paket internet wifi:\n` +
                `1. Paket 3 Jam - Rp 1.000\n` +
                `2. Paket 7 Jam - Rp 2.000\n` +
                `3. Paket 10 Jam - Rp 3.000\n` +
                `4. Paket 36 Jam - Rp 5.000\n\n` +
                `Balas dengan angka *1*, *2*, *3*, atau *4* untuk membeli.`;
            await sock.sendMessage(from, { text: menuText });
        }
        else if (!['1', '2', '3', '4'].includes(text) && !transaksiPending[from]) {
            await sock.sendMessage(from, { 
                text: `Halo! Selamat datang di *Super Wifi*.\n\nSilakan ketik *beli* atau *pesan* untuk melanjutkan pembelian paket internet.` 
            });
        }
        else if (['1', '2', '3', '4'].includes(text)) {
            const daftarPaket = {
                '1': 'Paket 3 Jam (Rp 1.000)',
                '2': 'Paket 7 Jam (Rp 2.000)',
                '3': 'Paket 10 Jam (Rp 3.000)',
                '4': 'Paket 36 Jam (Rp 5.000)'
            };
            const namaPaket = daftarPaket[text];
            
            if (transaksiPending[from]) {
                clearTimeout(transaksiPending[from].timeout);
            }

            const timeoutId = setTimeout(async () => {
                if (transaksiPending[from]) {
                    delete transaksiPending[from];
                    await sock.sendMessage(from, { 
                        text: `⚠️ Waktu transaksi telah habis.\nPesanan untuk *${namaPaket}* dibatalkan otomatis.\n\nKetik *pesan* jika ingin memesan ulang.` 
                    });
                }
            }, 5 * 60 * 1000);

            transaksiPending[from] = { 
                jId: from,
                paket: text, 
                timestamp: Date.now(),
                timeout: timeoutId 
            };

            try {
                await sock.sendMessage(from, {
                    image: { url: qrisGambar[text] },
                    caption: `Pembelian *${namaPaket}*\n\n` +
                        `Silakan scan QRIS di atas untuk pembayaran.\n\n` +
                        `📸 *Penting:* Mohon kirimkan bukti screenshot transaksi setelah membayar.\n` +
                        `Silahkan menunggu, voucher akan dikirim otomatis oleh admin.`
                });
            } catch (e) {
                await sock.sendMessage(from, {
                    text: `Pembelian *${namaPaket}*\n\n` +
                        `Silakan transfer ke QRIS kami.\n\n` +
                        `📸 *Penting:* Mohon kirimkan bukti screenshot transaksi setelah membayar.\n` +
                        `Silahkan menunggu, voucher akan dikirim otomatis oleh admin.`
                });
            }

            // Hitung nomor urutan antrean saat ini
            const listPendingNow = Object.values(transaksiPending);
            listPendingNow.sort((a, b) => a.timestamp - b.timestamp);
            const pos = listPendingNow.findIndex(t => t.jId === from) + 1;

            const pesanAdmin = `📩 *NOTIFIKASI TAGIHAN BARU*\n\n` +
                `Nomor Antrean: *#${pos}*\n` +
                `Pembeli: wa.me/${senderNumber}\n` +
                `Paket: ${namaPaket}\n` +
                `Status: Menunggu Pembayaran & Bukti Transfer\n\n` +
                `Perintah Admin:\n` +
                `- Ketik *siap ${pos}* (ACC pesanan ini)\n` +
                `- Ketik *cancel ${pos}* (Batalkan pesanan ini)`;

            const adminJidFormatted = BOT_NUMBER + '@s.whatsapp.net';
            await sock.sendMessage(adminJidFormatted, { text: pesanAdmin });
        }
    });
}

startBot();