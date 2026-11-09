import test from 'node:test';
import assert from 'node:assert/strict';
import { _test } from '../netlify/functions/site-audit.mjs';

const sample = (body, head='') => '<!doctype html><html lang="ru"><head><title>Магазин материалов в Петербурге</title><meta name="description" content="Описание"><meta name="viewport" content="width=device-width,initial-scale=1">'+head+'</head><body><main>'+body+'</main></body></html>';

test('rejects local addresses before outbound connection', () => {
  for (const url of ['http://localhost/', 'https://127.0.0.1', 'https://private.local', 'https://example.com:8443/']) {
    assert.throws(() => _test.validateTarget(url));
  }
});

test('extracts evidence for question headings, paragraph, contacts and visible words', () => {
  const paragraph = Array(45).fill('предлагаем качественные строительные материалы').join(' ');
  const html = sample('<h1>Стройматериалы</h1><h2>Где купить гипсокартон?</h2><p>'+paragraph+'</p><a href="tel:+79990000000">Позвонить</a><h2>Часто задаваемые вопросы</h2>');
  const tags = _test.extract(html);
  assert.equal(tags.questionHeadings,1);
  assert.ok(tags.firstParagraphWords >= 40);
  assert.ok(tags.visibleWords >= 90);
  assert.equal(tags.hasContact,true);
  assert.equal(tags.hasFaq,true);
});

test('invalid JSON-LD is not accepted as company schema', () => {
  const html = sample('<h1>Организация</h1>', '<script type="application/ld+json">{invalid}</script>');
  const tags = _test.extract(html);
  assert.equal(tags.organizationSchema,false);
  assert.equal(tags.validJsonLd,0);
});

test('accepts valid Organization schema and sameAs', () => {
  const html = sample('<h1>Организация</h1>', '<script type="application/ld+json">'+JSON.stringify({
    '@context':'https://schema.org', '@type':'Organization',name:'Пример',
    sameAs:['https://example.org/profile']
  })+'</script>');
  const tags=_test.extract(html);
  assert.equal(tags.organizationSchema,true);
  assert.equal(tags.sameAsCount,1);
});

test('robots user agent distinctions are preserved', () => {
  const robots='User-agent: GPTBot\nDisallow: /\nUser-agent: OAI-SearchBot\nAllow: /\n';
  assert.equal(_test.robotsDecision(robots,'GPTBot').blocked,true);
  assert.equal(_test.robotsDecision(robots,'OAI-SearchBot').blocked,false);
});
