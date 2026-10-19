const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    downloadMediaMessage
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const readline = require('readline');

// ==========================================
// KONFIGURASI BOT & HARGA VOUCHER SUPER WIFI
// ==========================================
const ADMIN_JID = '6283133882711@s.whatsapp.net'; 
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
            if (!msg.message || msg.key.fromMe) continue;

            const from = msg.key.remoteJid;
            const isImage = msg.message.imageMessage || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
            const body = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || '';
            const text = body.trim().toLowerCase();

            // Helper untuk kirim menu utama
            const kirimMenuUtama = async (jid) => {
                const menuText = `=== 📶 SUPER WIFI - LOGIN ===\n\n` +
                    `Silakan pilih paket internet wifi:\n` +
                    `1. Paket 3 Jam - Rp 1.000\n` +
                    `2. Paket 7 Jam - Rp 2.000\n` +
                    `3. Paket 10 Jam - Rp 3.000\n` +
                    `4. Paket 36 Jam - Rp 5.000\n\n` +
                    `Balas dengan angka *1*, *2*, *3*, atau *4* untuk membeli.`;
                await sock.sendMessage(jid, { text: menuText });
            };

            // 1. Dengar Kata Kunci Beli/Menu/Pesan
            if (['menu', 'ping', '0', 'beli', 'pesan'].includes(text)) {
                await kirimMenuUtama(from);
            }

            // 2. Pilih Paket 1 - 4
            else if (['1', '2', '3', '4'].includes(text)) {
                const daftarPaket = {
                    '1': 'Paket 3 Jam (Rp 1.000)',
                    '2': 'Paket 7 Jam (Rp 2.000)',
                    '3': 'Paket 10 Jam (Rp 3.000)',
                    '4': 'Paket 36 Jam (Rp 5.000)'
                };
                const namaPaket = daftarPaket[text];
                
                transaksiPending[from] = { paket: text, timestamp: Date.now() };

                try {
                    await sock.sendMessage(from, {
                        image: { url: qrisGambar[text] },
                        caption: `Pembelian *${namaPaket}*\n\n` +
                            `Silakan scan QRIS di atas untuk pembayaran.\n\n` +
                            `📸 *Setelah transfer, langsung kirimkan FOTO/SCREENSHOT BUKTI TRANSFER di sini.*`
                    });
                } catch (e) {
                    await sock.sendMessage(from, {
                        text: `Pembelian *${namaPaket}*\n\n` +
                            `Silakan transfer ke QRIS kami.\n\n` +
                            `📸 *Setelah transfer, langsung kirimkan FOTO/SCREENSHOT BUKTI TRANSFER di sini.*`
                    });
                }
            }

            // 3. Deteksi Pembeli Mengirim Foto (Bukti Transfer)
            else if (isImage && from !== ADMIN_JID) {
                if (!transaksiPending[from]) {
                    await sock.sendMessage(from, { text: '⚠️ Anda belum memilih paket. Ketik *beli* atau *pesan* terlebih dahulu.' });
                    continue;
                }

                const trx = transaksiPending[from];
                const daftarHargaNama = { 
                    '1': '3 Jam (Rp 1.000)', 
                    '2': '7 Jam (Rp 2.000)', 
                    '3': '10 Jam (Rp 3.000)', 
                    '4': '36 Jam (Rp 5.000)' 
                };
                const namaPaket = daftarHargaNama[trx.paket];

                // Download gambar dari pembeli
                const buffer = await downloadMediaMessage(msg, 'buffer', {});

                const pesanAdmin = `📩 *BUKTI PEMBAYARAN BARU*\n\n` +
                    `Pembeli: wa.me/${from.split('@')[0]}\n` +
                    `Paket: ${namaPaket}\n` +
                    `ID Pembeli: ${from}\n\n` +
                    `💡 *CARA ACC CEPAT:*\n` +
                    `Reply / Balas foto ini lalu ketik:\n` +
                    `*!acc ${trx.paket}* (atau format lama: *!acc <nomor> <paket>*)`;

                await sock.sendMessage(ADMIN_JID, { 
                    image: buffer, 
                    caption: pesanAdmin 
                });

                await sock.sendMessage(from, {
                    text: `✅ Bukti transfer Anda telah diterima dan sedang diverifikasi Admin.\nKode voucher akan dikirim otomatis setelah diverifikasi.`
                });
            }

            // 4. Perintah ACC Ringkas dari Admin
            else if (text.startsWith('!acc') && from === ADMIN_JID) {
                const args = body.trim().split(' ');
                let targetNum = '';
                let paketId = '';

                // Opsi A: Admin Reply pesan notifikasi dan cuma ketik `!acc <paket>` (contoh: !acc 1)
                const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (quotedMsg && args.length === 2) {
                    paketId = args[1];
                    const quotedText = quotedMsg.imageMessage?.caption || quotedMsg.conversation || '';
                    const match = quotedText.match(/ID Pembeli:\s*([^\s]+)/);
                    if (match) {
                        targetNum = match[1];
                    }
                } 
                // Opsi B: Format manual lama (`!acc <nomor> <paket>`)
                else if (args.length >= 3) {
                    targetNum = args[1] + '@s.whatsapp.net';
                    paketId = args[2];
                }

                if (!targetNum || !paketId) {
                    await sock.sendMessage(from, { text: '⚠️ Format salah!\n\nCara simpel: Reply foto notifikasi lalu ketik *!acc 1*\nAtau manual: *!acc <nomor> <paket*' });
                    continue;
                }

                if (stokVoucher[paketId] && stokVoucher[paketId].length > 0) {
                    const kodeVoucher = stokVoucher[paketId].shift();

                    await sock.sendMessage(targetNum, {
                        text: `🎉 *PEMBAYARAN DITERIMA!*\n\n` +
                            `Berikut adalah Kode Voucher Super Wifi Anda:\n` +
                            `🔑 Kode: *${kodeVoucher}*\n\n` +
                            `Silakan masukkan kode tersebut di halaman login Wi-Fi. Terima kasih!`
                    });

                    await sock.sendMessage(from, { 
                        text: `✅ Berhasil mengirim voucher *${kodeVoucher}* ke ${targetNum.split('@')[0]}. Sisa stok: ${stokVoucher[paketId].length}` 
                    });

                    delete transaksiPending[targetNum];
                } else {
                    await sock.sendMessage(from, { text: `⚠️ Stok voucher paket ${paketId} HABIS!` });
                }
            }

            // 5. Default Chat Random (Teks)
            else if (from !== ADMIN_JID) {
                await sock.sendMessage(from, { text: 'Silahkan ketik *beli* atau *pesan* untuk lanjut beli voucher.' });
            }
        }
    });
}

startBot();