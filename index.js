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

let transaksiPending = [];

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
        const isGroup = from.endsWith('@g.us');
        
        // --- PERBAIKAN: Ekstraksi Nomor Asli Pelanggan yang Akurat ---
        let senderJid = isGroup ? m.key.participant : from;
        let senderNumber = senderJid ? senderJid.replace(/[^0-9]/g, '') : '';
        
        if (!senderNumber || senderNumber.length < 10) {
            senderNumber = m.pushName || 'Pelanggan';
        }
        // ---------------------------------------------------------

        const body = m.message.conversation || m.message.extendedTextMessage?.text || '';
        const text = body.trim();

        console.log(`[LOG] Dari JID: ${from} | Nomor Ekstraksi: ${senderNumber} | Teks: "${text}" | fromMe: ${m.key.fromMe}`);

        const isAdminAction = m.key.fromMe;

        if (isAdminAction) {
            const lowerText = text.toLowerCase().replace(/\s+/g, ''); 

            // 1. Perintah Admin ACC
            if (lowerText.startsWith('siap')) {
                const indexStr = lowerText.replace('siap', '');
                const index = indexStr ? parseInt(indexStr) - 1 : 0; 

                if (transaksiPending.length === 0) {
                    await sock.sendMessage(from, { text: '⚠️ Tidak ada transaksi pending saat ini.' });
                    return;
                }

                if (isNaN(index) || index < 0 || index >= transaksiPending.length) {
                    await sock.sendMessage(from, { 
                        text: `⚠️ Antrean #${index + 1} tidak ditemukan!\nSaat ini ada ${transaksiPending.length} pesanan aktif dalam antrean.` 
                    });
                    return;
                }

                const currentTrx = transaksiPending[index];
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

                    await sock.sendMessage(targetNum, {
                        text: `🎉 *PEMBAYARAN DITERIMA!*\n\n` +
                            `Berikut adalah Kode Voucher Super Wifi Anda:\n` +
                            `🔑 Kode: *${kodeVoucher}*\n\n` +
                            `Silakan masukkan kode tersebut di halaman login Wi-Fi. Terima kasih!`
                    });

                    await sock.sendMessage(from, { 
                        text: `✅ Berhasil ACC pesanan antrean #${index + 1} (*${namaPaket}*)\nKode terkirim: *${kodeVoucher}*\nSisa stok paket: ${stokVoucher[paketId].length}` 
                    });

                    clearTimeout(currentTrx.timeout);
                    transaksiPending.splice(index, 1); 
                } else {
                    await sock.sendMessage(from, { text: `⚠️ Stok voucher untuk paket ${namaPaket} HABIS!` });
                }
                return;
            }

            // 2. Perintah Admin Cancel
            if (lowerText.startsWith('cancel')) {
                const indexStr = lowerText.replace('cancel', '');
                const index = indexStr ? parseInt(indexStr) - 1 : 0;

                if (transaksiPending.length === 0) {
                    await sock.sendMessage(from, { text: '⚠️ Tidak ada transaksi pending untuk dibatalkan.' });
                    return;
                }

                if (isNaN(index) || index < 0 || index >= transaksiPending.length) {
                    await sock.sendMessage(from, { 
                        text: `⚠️ Antrean #${index + 1} tidak ditemukan!\nSaat ini ada ${transaksiPending.length} pesanan aktif dalam antrean.` 
                    });
                    return;
                }

                const currentTrx = transaksiPending[index];
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
                transaksiPending.splice(index, 1);
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
        else if (!['1', '2', '3', '4'].includes(text) && !transaksiPending.some(t => t.jId === from)) {
            await sock.sendMessage(from, { 
                text: `Halo! Selamat datang di *Super Wifi*.\n\nSilakan ketik *beli* atau *pesan* untuk melanjutkan pembelian paket internet.` 
            });
        }
        else if (['1', '2', '3', '4'].includes(text)) {
            const daftarPaket = {
                '1': 'Paket 3 Jam (Rp 1.000)',
                '2': '7 Jam (Rp 2.000)',
                '3': '10 Jam (Rp 3.000)',
                '4': '36 Jam (Rp 5.000)'
            };
            const namaPaket = daftarPaket[text];

            const trxId = Date.now();
            const timeoutId = setTimeout(async () => {
                const idx = transaksiPending.findIndex(t => t.id === trxId);
                if (idx !== -1) {
                    transaksiPending.splice(idx, 1);
                    await sock.sendMessage(from, { 
                        text: `⚠️ Waktu transaksi telah habis.\nPesanan untuk *${namaPaket}* dibatalkan otomatis.\n\nKetik *pesan* jika ingin memesan ulang.` 
                    });
                }
            }, 5 * 60 * 1000);

            const newTrx = {
                id: trxId,
                jId: from,
                paket: text,
                timestamp: Date.now(),
                timeout: timeoutId
            };

            transaksiPending.push(newTrx);
            const nomorAntrean = transaksiPending.length; 

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

            const pesanAdmin = `📩 *NOTIFIKASI TAGIHAN BARU*\n\n` +
                `Nomor Antrean: *#${nomorAntrean}*\n` +
                `Pembeli: wa.me/${senderNumber}\n` +
                `Paket: ${namaPaket}\n` +
                `Status: Menunggu Pembayaran & Bukti Transfer\n\n` +
                `Perintah Admin:\n` +
                `- Ketik *siap ${nomorAntrean}* (untuk ACC pesanan ini)\n` +
                `- Ketik *cancel ${nomorAntrean}* (untuk membatalkan pesanan ini)`;

            const adminJidFormatted = ADMIN_NUMBER + '@s.whatsapp.net';
            await sock.sendMessage(adminJidFormatted, { text: pesanAdmin });
        }
    });
}

startBot();