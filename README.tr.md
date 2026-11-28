# PiClaw — kendi sunucunuzda barındırılan yapay zekâ çalışma alanı

![PiClaw](docs/icon-256.png)

Diller: [English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · **Türkçe**

PiClaw, [Pi Coding Agent](https://github.com/earendil-works/pi) üzerine inşa edilmiş, varsayılan olarak tek kullanıcılı, kendi sunucunuzda barındırılan (self-hosted) bir yapay zekâ çalışma alanıdır. Aynı tarayıcı penceresi içinde bir ajanla çalışın, dosyaları düzenleyin, komutları çalıştırın ve sonuçları inceleyin. Sohbetler, dosyalar ve zamanlanmış görevler ziyaretler arasında kalıcıdır; model istekleri, yerel OpenAI uyumlu sunucular da dahil olmak üzere yapılandırdığınız sağlayıcıya gider.

Web arayüzü masaüstü ve mobil düzenlerle İngilizce, Basitleştirilmiş Çince ve Japonca dillerini destekler. Ajanın erişebileceği dosya ve hizmetleri sınırlandırmak için bir konteyner, sanal makine (VM) veya özel bir makine kullanın.

![Demo Animasyonu](docs/demo.gif)

## Kurulum

| Yöntem | Kullanım amacı |
|---|---|
| [Docker](#docker-ile-hızlı-başlangıç) | Önerilen dağıtım yöntemi; Bun, PiClaw ve paketlenmiş komut satırı araçlarını içerir |
| [Taşınabilir sürüm](docs/getting-started.md#portable-releases) | Docker olmadan Linux, Apple Silicon macOS veya deneysel Windows kullanımı; Bun ve çalışma zamanı bağımlılıklarını içerir |
| [Bun depo kurulumu](docs/install-from-repo.md) | Mevcut bir Bun kurulumunu kullanan deneysel etiketli kurulum |
| [Kaynaktan derleme](docs/development.md) | Geliştirme ve yerel test |

Yayımlanan indirmeler [GitHub Releases](https://github.com/rcarmo/piclaw/releases) sayfasında, konteyner imajları ise [GHCR](https://github.com/rcarmo/piclaw/pkgs/container/piclaw) üzerindedir. Tekrarlanabilir dağıtımlar için bir sürüm etiketini sabitleyin.

### Docker ile hızlı başlangıç

Docker'a ve bir model sağlayıcısı kimlik bilgisine ya da erişilebilir bir yerel model sunucusuna ihtiyacınız vardır. Sağlayıcı kurulumu başlangıçtan sonra yapılır.

> [!WARNING]
> Yeni bir kurulumda web giriş koruması yoktur. Aşağıdaki komut portu **yalnızca localhost** üzerinde yayımlar. Kimlik doğrulamayı yapılandırırken örneği gizli tutun. Korumasız bir örneğe erişimi olan herkes ajanın dosyalarını ve araçlarını kullanabilir.

```bash
mkdir -p ./home ./workspace

docker run -d \
  --init \
  --name piclaw \
  --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -e PICLAW_WEB_PORT=8080 \
  -v "$(pwd)/home:/config" \
  -v "$(pwd)/workspace:/workspace" \
  ghcr.io/rcarmo/piclaw:latest
```

1. Docker ana makinesinde [http://localhost:8080](http://localhost:8080) adresini açın.
2. Bir **model sağlayıcısı** yapılandırmak için sohbette `/login` gönderin. Bu işlem tarayıcı oturum açmadan ayrıdır. PiClaw, Pi'nin sağlayıcı kimlik bilgilerini yeniden kullanır; Docker komutunun içine API anahtarları koymanız gerekmez.
3. `/model` ile bir model seçin, ardından şunu deneyin: “Çalışma alanında bir Markdown kontrol listesi oluştur ve dosyayı bana göster.”
4. Diğer makinelerden erişime izin vermeden önce [tarayıcı kimlik doğrulamasını](docs/getting-started.md#secure-browser-access) ve HTTPS'yi kurun.

Hem `./home` hem de `./workspace` kalıcı verilerdir. Konteyneri değiştirirken bunları koruyun; PiClaw'ı sıfırlamak veya yükseltmek için **asla `workspace/.piclaw/store/messages.db` dosyasını silmeyin**. Bkz. [ilk çalıştırma kontrolleri, yedeklemeler ve yükseltmeler](docs/getting-started.md).

## Neler yapabilirsiniz?

| Görev | Çekirdekte yer alanlar |
|---|---|
| Ajanla çalışma | Akışlı sohbet, model seçimi, canlı yönlendirme, kuyruğa alınmış takip mesajları, ayrı sohbetler ve `/btw` yan soruları |
| Dosyalarla çalışma | Çalışma alanı tarayıcısı, yüklemeler, CodeMirror düzenleyici, kabuk araçları ve ayrılabilir xterm.js terminali |
| Sonuçları inceleme | CSV/TSV tabloları, PDF, görsel, video ve kod görüntüleyiciler; VNC uzak ekran bölmeleri |
| Ziyaretler arasında çalışmayı sürdürme | Zamanlanmış görevler, aranabilir sohbet geçmişi ve dosya tabanlı [Dream memory](docs/dream-memory.md) |
| İş akışlarını genişletme | Beceriler (Skills), [MCP sunucuları](docs/mcp.md), tarayıcı otomasyonu, görsel işleme, A2UI yüzeyleri ve etkileşimli görsel çıktılar |

Kontroller ve komutlar [web arayüzü kılavuzu](docs/web-ui.md#chat-and-status-surfaces) ile [araçlar ve beceriler başvurusunda](docs/tools-and-skills.md) anlatılmıştır. Yerel model kurulumu [llama.cpp](docs/llama-cpp.md) sayfasında belgelenmiştir; Azure görsel üretimi için [Azure OpenAI/Foundry yapılandırması](docs/azure/azure-openai-extension.md) gerekir.

[İsteğe bağlı eklentiler](https://rcarmo.github.io/piclaw-addons/) Draw.io, Office belge işleme ve araçları, kanban panoları, alternatif terminal oluşturucular, Windows masaüstü otomasyonu, Proxmox, Portainer, Microsoft 365 ve eşleştirilmiş örnek mesajlaşması sunar. Bunları [Ayarlar ve eklentiler](docs/settings-and-addons.md) üzerinden ayrı olarak kurabilirsiniz.

## Güvenlik ve sınırlar

- **Tek kullanıcılı çalışma.** Aile hesapları ve dağıtımı kaldırılmıştır. İzole konteyner modu kullanılamamaktadır. Doğrulama ve geçmiş veri deposunun korunması için bkz. [Erişim modları](docs/access-modes.md).
- Ajan, süreç kullanıcısının izinleriyle çalışır. Yerel kurulumlar o kullanıcının dosya ve komutlarına erişebilir; konteynerler ise bağlanan dosyaları ve yapılandırılan ağ erişimini dışa açar. Özel bir ortam kullanın ve yalnızca paylaşmak istediğiniz dizinleri bağlayın.
- Tarayıcı kimlik doğrulaması doğrulayıcı kodlarını (TOTP) ve geçiş anahtarlarını (passkey) destekler. Arka ucu gizli tutun, uzaktan erişim için HTTPS kullanın ve yalnızca yapılandırdığınız [ters vekil sunucudan (reverse proxy)](docs/reverse-proxy.md) gelen iletilmiş başlıklara güvenin.
- Etkinleştirilen çalışma zamanı kilitlemesi, eski veya hatalı biçimlendirilmiş kayıtlar dahil mevcut tüm kilit yollarını reddeder. Bir çökme durumunda başlatma veya bakım öncesinde [çevrimdışı operatör temizliği](docs/runtime-lock.md#existing-runtime-locks) gerekebilir; bir sahip çalışıyor olabilecekken asla kilidi kaldırmayın.
- Kendi sunucunuzda barındırmak uygulama durumunu makinenizde tutar. Bulut modelleri ve harici araçlar kendilerine gönderdiğiniz verileri yine de alır. İsteğe bağlı [anahtar zinciri (keychain)](docs/keychain.md) bir ana anahtar gerektirir ve tüm çalışma alanını veya sohbet geçmişini şifrelemez.

## Dokümantasyon

- [Başlarken](docs/getting-started.md) — kurulum, ilk sohbet, kimlik doğrulama, kalıcılık ve yükseltmeler
- [Çevrimdışı oturum geçmişi içe aktarma](docs/development/session-history-import.md) — seçili v3 JSONL verisini yeni ve ayrı bir v4 deposuna aktarma; yerinde veritabanı geçişi yoktur
- [Yapılandırma](docs/configuration.md) — ayarlar, yollar, sağlayıcılar, SSH araçları ve ortam değişkeni geçersiz kılmaları
- [Web Arayüzü](docs/web-ui.md#chat-and-status-surfaces) — sohbet, çalışma alanı, düzenleyici, terminal ve görüntüleyiciler
- [Dokümantasyon dizini](docs/README.md) — operasyonlar, entegrasyonlar, geliştirme ve mimari

## Katkıda Bulunma

İş öğeleri ve hata bildirimleri **[GitHub Issues](https://github.com/rcarmo/piclaw/issues)** üzerinden takip edilir.

- [Bir iş öğesi veya hata bildirimi açın](https://github.com/rcarmo/piclaw/issues/new?template=workitem.md)
- [Bir soru sorun](https://github.com/rcarmo/piclaw/issues/new?template=question.md)
- [Proje panosunu görüntüleyin](https://github.com/users/rcarmo/projects/13)

Sorun bildirirken konu şablonlarını kullanın. Kod değişiklikleri için [geliştirme](docs/development.md), [yerel doğrulama](docs/native-validation.md) ve [depo iş akışı](AGENTS.md) belgelerini okuyun; değişiklikleri bir pull request üzerinden gönderin. `make ci-full` ana makine ve çevrimdışı yerel doğrulama gerektirir; `make ci-fast` yalnızca ana makineyi kapsar.

## Teşekkürler

- piclaw tarafından kullanılan Pi çekirdeği için [pi.dev](http://pi.dev)
- [rcarmo/vibes](https://github.com/rcarmo/vibes) — özgün PiClaw UX tasarımı
- [qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw)
- [earendil-works/pi](https://github.com/earendil-works/pi)
- [davebcn87/pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) — Tobi Lutke ve David Cortés tarafından geliştirilen otonom deney döngüsü (artık `rcarmo/piclaw-addons` içindeki autoresearch eklentisinde taşınmaktadır)
- [nicobailon/visual-explainer](https://github.com/nicobailon/visual-explainer) — Nico Bailon'un görsel çıktı üretme becerisi felsefesi, istem iş akışı ve şablon kalıpları (doğrudan dahil edilmemiştir, uyarlanmıştır)

> [!NOTE]
> piclaw, [pi.dev](https://pi.dev) ile **doğrudan bağlantılı değildir**. Pi çekirdeği üzerine inşa edilmiş türev bir çalışmadır ve kendi çalışma zamanı, araçları ile arayüz katmanlarını ekler.

## Lisans

[MIT](LICENSE)
