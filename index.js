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

    // Menggunakan event 'messages.set' atau memantau semua upsert tanpa filter ketat fromMe
    sock.ev.on('messages.upsert', async (chatUpdate) => {
        const m = chatUpdate.messages[0];
        if (!m.message) return;

        const from = m.key.remoteJid;
        const senderNumber = from ? from.split('@')[0] : '';
        const body = m.message.conversation || m.message.extendedTextMessage?.text || '';
        const text = body.trim();

        console.log(`[LOG] Pesan dari: ${senderNumber} | Teks: "${text}" | fromMe: ${m.key.fromMe}`);

        // Cek apakah ini perintah dari admin (nomor admin sendiri)
        const isAdmin = senderNumber === ADMIN_NUMBER;

        if (isAdmin) {
            if (text.toLowerCase() === 'siap') {
                console.log(`[ADMIN] Eksekusi perintah SIAP...`);
                const listPending = Object.values(transaksiPending);

                if (listPending.length === 0) {
                    await sock.sendMessage(ADMIN_NUMBER + '@s.whatsapp.net', { text: '⚠️ Tidak ada transaksi pending saat ini.' });
                    return;
                }

                listPending.sort((a, b) => a.timestamp - b.timestamp);
                const currentTrx = listPending[0];
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

                    // Kirim ke pembeli
                    await sock.sendMessage(targetNum, {
                        text: `🎉 *PEMBAYARAN DITERIMA!*\n\n` +
                            `Berikut adalah Kode Voucher Super Wifi Anda:\n` +
                            `🔑 Kode: *${kodeVoucher}*\n\n` +
                            `Silakan masukkan kode tersebut di halaman login Wi-Fi. Terima kasih!`
                    });

                    // Konfirmasi ke admin
                    await sock.sendMessage(ADMIN_NUMBER + '@s.whatsapp.net', { 
                        text: `✅ Berhasil ACC pesanan *${namaPaket}* untuk ${targetNum.split('@')[0]}\nKode terkirim: *${kodeVoucher}*\nSisa stok: ${stokVoucher[paketId].length}` 
                    });

                    clearTimeout(currentTrx.timeout);
                    delete transaksiPending[targetNum];
                } else {
                    await sock.sendMessage(ADMIN_NUMBER + '@s.whatsapp.net', { text: `⚠️ Stok voucher untuk paket ${namaPaket} HABIS!` });
                }
                return;
            }

            if (text.toLowerCase() === 'cancel') {
                console.log(`[ADMIN] Eksekusi perintah CANCEL...`);
                const listPending = Object.values(transaksiPending);

                if (listPending.length === 0) {
                    await sock.sendMessage(ADMIN_NUMBER + '@s.whatsapp.net', { text: '⚠️ Tidak ada transaksi pending untuk dibatalkan.' });
                    return;
                }

                listPending.sort((a, b) => a.timestamp - b.timestamp);
                const currentTrx = listPending[0];
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

                await sock.sendMessage(ADMIN_NUMBER + '@s.whatsapp.net', { 
                    text: `❌ Berhasil membatalkan pesanan *${namaPaket}* dari ${targetNum.split('@')[0]}` 
                });

                clearTimeout(currentTrx.timeout);
                delete transaksiPending[targetNum];
                return;
            }
        }

        // Jangan proses pesan dari bot/admin sendiri untuk menu pembeli
        if (m.key.fromMe) return;

        // 2. Logika Pembeli (Menu & Pilih Paket)
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
                '2': '7 Jam (Rp 2.000)',
                '3': '10 Jam (Rp 3.000)',
                '4': '36 Jam (Rp 5.000)'
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

            const pesanAdmin = `📩 *NOTIFIKASI TAGIHAN BARU*\n\n` +
                `Pembeli: wa.me/${senderNumber}\n` +
                `Paket: ${namaPaket}\n` +
                `Status: Menunggu Pembayaran & Bukti Transfer\n\n` +
                `Perintah Admin:\n- Ketik *siap* (untuk ACC & kirim voucher)\n- Ketik *cancel* (untuk batalkan pesanan)`;

            await sock.sendMessage(ADMIN_NUMBER + '@s.whatsapp.net', { text: pesanAdmin });
        }
    });
}

startBot();