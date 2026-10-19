const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const readline = require('readline');

// ==========================================
// KONFIGURASI BOT
// ==========================================
// 1. Ganti dengan nomor WhatsApp Admin (format: 628xxx@s.whatsapp.net)
const ADMIN_JID = '6283133882711@s.whatsapp.net'; 

// 2. Nomor HP WhatsApp Bot untuk menerima Pairing Code (Format 62, contoh: '628123456789')
const BOT_NUMBER = '6283133882711'; // <-- ISI / SESUAIKAN DENGAN NOMOR BOT KAMU!

// 3. Stok Kode Voucher Wi-Fi
const stokVoucher = {
    '1': ['3JAM-ABC12', '3JAM-XYZ34', '3JAM-KLM56'], // Paket 3 Jam (Rp 2.000)
    '2': ['24JAM-QWE78', '24JAM-RTY90', '24JAM-UIO12']  // Paket 24 Jam (Rp 5.000)
};

// 4. Penyimpanan Transaksi Sementara
const transaksiPending = {};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }), // Mengurangi spam log agar kode pairing kelihatan jelas
        auth: state,
        printQRInTerminal: false // Matikan QR Code agar tidak pakai kamera
    });

    // Minta Kode Pairing jika belum login
    if (!sock.authState.creds.registered) {
        let phoneNumber = BOT_NUMBER;
        if (!phoneNumber) {
            phoneNumber = await question('Masukkan nomor WhatsApp Bot Anda (Contoh 628xxx): ');
        }
        phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
        
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n==================================================`);
                console.log(`🔑 KODE PAIRING WHATSAPP KAMU: ${code?.match(/.{1,4}/g)?.join('-') || code}`);
                console.log(`==================================================\n`);
            } catch (err) {
                console.error('Gagal meminta kode pairing:', err);
            }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    // Menangani Update Koneksi
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus. Mencoba menghubungkan kembali...', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ Bot WhatsApp Penjualan Wi-Fi Siap Digunakan!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const from = msg.key.remoteJid;
            const body = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            const text = body.trim();

            // Menu Utama
            if (text.toLowerCase() === 'menu' || text.toLowerCase() === 'ping' || text === '0') {
                const menuText = `=== 📶 BOT VOUCHER WI-FI ===\n\n` +
                    `Silakan pilih paket voucher:\n` +
                    `1. Paket 3 Jam - Rp 2.000\n` +
                    `2. Paket 24 Jam - Rp 5.000\n\n` +
                    `Balas dengan angka *1* atau *2* untuk membeli.`;
                await sock.sendMessage(from, { text: menuText });
            }

            // Pilihan Paket 1 atau 2
            else if (text === '1' || text === '2') {
                const namaPaket = text === '1' ? 'Paket 3 Jam (Rp 2.000)' : 'Paket 24 Jam (Rp 5.000)';
                
                // Simpan transaksi pending
                transaksiPending[from] = { paket: text, timestamp: Date.now() };

                // Kirim QRIS Gambar jika ada, atau pesan instruksi
                try {
                    await sock.sendMessage(from, {
                        image: { url: './qris.jpeg' },
                        caption: `Pembelian *${namaPaket}*\n\n` +
                            `Silakan scan QRIS DANA di atas untuk melakukan pembayaran.\n\n` +
                            `Setelah transfer, ketik *!bayar* untuk konfirmasi pembayaran.`
                    });
                } catch (e) {
                    await sock.sendMessage(from, {
                        text: `Pembelian *${namaPaket}*\n\n` +
                            `Silakan transfer ke QRIS DANA kami.\n\n` +
                            `Setelah transfer, ketik *!bayar* untuk konfirmasi.`
                    });
                }
            }

            // Pembeli Ketik !bayar
            else if (text.toLowerCase() === '!bayar') {
                if (!transaksiPending[from]) {
                    await sock.sendMessage(from, { text: '⚠️ Anda belum memilih paket. Ketik *menu* untuk melihat daftar paket.' });
                    continue;
                }

                const trx = transaksiPending[from];
                const namaPaket = trx.paket === '1' ? '3 Jam (Rp 2.000)' : '24 Jam (Rp 5.000)';

                // Notifikasi ke Admin via WA
                const pesanAdmin = `📩 *NOTIFIKASI PEMBAYARAN MASUK*\n\n` +
                    `Pembeli: wa.me/${from.split('@')[0]}\n` +
                    `Paket: ${namaPaket}\n\n` +
                    `Cek saldo DANA Anda. Jika sudah masuk, ketik perintah berikut untuk ACC:\n` +
                    `*!acc ${from.split('@')[0]} ${trx.paket}*`;

                await sock.sendMessage(ADMIN_JID, { text: pesanAdmin });

                // Balasan ke Pembeli
                await sock.sendMessage(from, {
                    text: `Pembayaran Anda sedang diverifikasi oleh Admin.\nMohon tunggu sejenak, kode voucher akan dikirim secara otomatis setelah diverifikasi.`
                });
            }

            // Perintah Admin untuk ACC (!acc <nomor_pembeli> <kode_paket>)
            else if (text.startsWith('!acc') && from === ADMIN_JID) {
                const args = text.split(' ');
                if (args.length < 3) {
                    await sock.sendMessage(from, { text: 'Format salah! Gunakan: !acc <nomor> <paket>' });
                    continue;
                }

                const targetNum = args[1] + '@s.whatsapp.net';
                const paketId = args[2];

                if (stokVoucher[paketId] && stokVoucher[paketId].length > 0) {
                    // Ambil voucher paling atas dan hapus dari stok
                    const kodeVoucher = stokVoucher[paketId].shift();

                    // Kirim Voucher ke Pembeli
                    await sock.sendMessage(targetNum, {
                        text: `🎉 *PEMBAYARAN DITERIMA!*\n\n` +
                            `Berikut adalah Kode Voucher Wi-Fi Anda:\n` +
                            `🔑 Kode: *${kodeVoucher}*\n\n` +
                            `Terima kasih telah membeli!`
                    });

                    // Konfirmasi ke Admin
                    await sock.sendMessage(from, { 
                        text: `✅ Berhasil mengirim voucher *${kodeVoucher}* ke ${args[1]}. Stok tersisa: ${stokVoucher[paketId].length}` 
                    });

                    // Hapus transaksi pending pembeli
                    delete transaksiPending[targetNum];
                } else {
                    await sock.sendMessage(from, { text: `⚠️ Stok voucher paket ${paketId} HABIS!` });
                }
            }
        }
    });
}

startBot();