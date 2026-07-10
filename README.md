# Alza Presenter Timer

Pouziti:

1. Na Macu spust `start-timer.command`.
2. Ovládání se otevře na `http://localhost:3000/control`.
3. iPhone připoj na stejnou Wi-Fi.
4. Na Macu v panelu uvidíš `iPhone URL` a QR kód.
5. Na iPhonu otevři Fotoaparát a naskenuj QR nebo adresu otevři ručně v Safari.
6. Na display stránce klepni na `Fullscreen` a otoč iPhone na šířku.
7. Mac používáš jako ovládání, iPhone jako samostatný displej.

Poznámky:

- Na iPhonu Safari nemusí standardní web fullscreen API fungovat vždy plně. Proto display používá i vlastní focus režim a nejlepší výsledek je přes `Sdílet -> Přidat na plochu`.
- Server zastavíš přes `stop-timer.command`.
- Řešení je bez externích balíčků a běží na lokální síti.
- QR obrázek se načítá přes externí QR image službu. Když nebude fungovat, použij URL ručně.
