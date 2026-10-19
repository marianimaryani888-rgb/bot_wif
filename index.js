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
const ADMIN_NUMBER = '6283133882711'; // Nomor WhatsApp Admin
const BOT_NUMBER = '6283133882711'; // Nomor Bot WhatsApp kamu

// Stok Kode Voucher Wi-Fi Sesuai Paket
const stokVoucher = {
    '1': ['3JAM-ABC12', '3JAM-XYZ34'], // Paket 3 Jam - Rp 1.000
    '2': ['7JAM-QWE78', '7JAM-RTY90'], // Paket 7 Jam - Rp 2.000
    '3': ['10JAM-UIO12', '10JAM-PAS34'],// Paket 10 Jam - Rp 3.000
    '4': ['36JAM-ZXC56', '36JAM-VBN78'] // Paket 36 Jam - Rp 5.000
};

// Pemetaan File Gambar QRIS Sesuai Paket
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

    // Minta Pairing Code jika belum terdaftar
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
                    console.log(`\n==================================================`);
                    console.log(`🔑 KODE PAIRING WHATSAPP KAMU: ${code?.match(/.{1,4}/g)?.join('-') || code}`);
                    console.log(`==================================================\n`);
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
            console.log('Koneksi terputus. Mencoba menghubungkan kembali...', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ Bot Super Wifi Siap Digunakan!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message) continue;

            const from = msg.key.remoteJid;
            const senderNumber = from.split('@')[0];
            const body = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            const text = body.trim();

            const isAdmin = senderNumber === ADMIN_NUMBER;

            if (msg.key.fromMe && !isAdmin) continue;

            console.log(`[PESAN MASUK] Dari: ${senderNumber} | Teks: "${text}"`);

            // 1. Perintah Admin untuk ACC ketik ".siap"
            if (text.toLowerCase() === '.siap' && isAdmin) {
                console.log(`[ADMIN ACTION] Admin mengetik '.siap'. Memproses antrean...`);
                const listPending = Object.values(transaksiPending);

                if (listPending.length === 0) {
                    await sock.sendMessage(from, { text: '⚠️ Tidak ada transaksi pending saat ini.' });
                    continue;
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

                    await sock.sendMessage(targetNum, {
                        text: `🎉 *PEMBAYARAN DITERIMA!*\n\n` +
                            `Berikut adalah Kode Voucher Super Wifi Anda:\n` +
                            `🔑 Kode: *${kodeVoucher}*\n\n` +
                            `Silakan masukkan kode tersebut di halaman login Wi-Fi. Terima kasih!`
                    });

                    await sock.sendMessage(from, { 
                        text: `✅ Berhasil ACC pesanan *${namaPaket}* untuk ${targetNum.split('@')[0]}\nKode terkirim: *${kodeVoucher}*\nSisa stok: ${stokVoucher[paketId].length}` 
                    });

                    clearTimeout(currentTrx.timeout);
                    delete transaksiPending[targetNum];
                } else {
                    await sock.sendMessage(from, { text: `⚠️ Stok voucher untuk paket ${namaPaket} HABIS!` });
                }
            }

            // 2. Perintah Admin untuk Cancel ketik ".cancel"
            else if (text.toLowerCase() === '.cancel' && isAdmin) {
                console.log(`[ADMIN ACTION] Admin mengetik '.cancel'. Membatalkan antrean teratas...`);
                const listPending = Object.values(transaksiPending);

                if (listPending.length === 0) {
                    await sock.sendMessage(from, { text: '⚠️ Tidak ada transaksi pending untuk dibatalkan.' });
                    continue;
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

                await sock.sendMessage(from, { 
                    text: `❌ Berhasil membatalkan pesanan *${namaPaket}* dari ${targetNum.split('@')[0]}` 
                });

                clearTimeout(currentTrx.timeout);
                delete transaksiPending[targetNum];
            }

            // 3. Cek jika perintah untuk melihat menu / mulai beli
            else if (text.toLowerCase() === 'menu' || text.toLowerCase() === 'ping' || text === '0' || text.toLowerCase() === 'beli' || text.toLowerCase() === 'pesan') {
                const menuText = `=== 📶 SUPER WIFI - LOGIN ===\n\n` +
                    `Silakan pilih paket internet wifi:\n` +
                    `1. Paket 3 Jam - Rp 1.000\n` +
                    `2. Paket 7 Jam - Rp 2.000\n` +
                    `3. Paket 10 Jam - Rp 3.000\n` +
                    `4. Paket 36 Jam - Rp 5.000\n\n` +
                    `Balas dengan angka *1*, *2*, *3*, atau *4* untuk membeli.`;
                await sock.sendMessage(from, { text: menuText });
            }

            // 4. Jika chat random / kapan saja dan belum punya transaksi aktif (selain admin)
            else if (!['1', '2', '3', '4'].includes(text) && !isAdmin && !transaksiPending[from]) {
                await sock.sendMessage(from, { 
                    text: `Halo! Selamat datang di *Super Wifi*.\n\nSilakan ketik *beli* atau *pesan* untuk melanjutkan pembelian paket internet.` 
                });
            }

            // 5. Pilihan Paket 1 sampai 4 oleh Pembeli
            else if (['1', '2', '3', '4'].includes(text) && !isAdmin) {
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

                const pesanAdmin = `📩 *NOTIFIKASI TAGIHAN BARU*\n\n` +
                    `Pembeli: wa.me/${senderNumber}\n` +
                    `Paket: ${namaPaket}\n` +
                    `Status: Menunggu Pembayaran & Bukti Transfer\n\n` +
                    `Perintah Admin:\n- Ketik *.siap* (untuk ACC & kirim voucher)\n- Ketik *.cancel* (untuk batalkan pesanan)`;

                const adminJidFormatted = ADMIN_NUMBER + '@s.whatsapp.net';
                await sock.sendMessage(adminJidFormatted, { text: pesanAdmin });
            }
        }
    });
}

startBot();