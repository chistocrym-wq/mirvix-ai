import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {_test as product,handler} from '../netlify/functions/competitor-products.mjs';
const root=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const sample='<!doctype html><html><head><title>Фанера 12 мм</title>'+
'<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Фанера 12 мм","sku":"FAN-12","brand":{"@type":"Brand","name":"Завод"},"description":"Фанера 12 мм","image":"https://shop.example-cdn.ru/img/fanera.jpg","additionalProperty":[{"name":"Толщина","value":"12 мм"}],"offers":{"@type":"Offer","price":"1 250,50","priceCurrency":"RUB","availability":"https://schema.org/InStock"}}</script></head><body><h1>Фанера</h1></body></html>';
test('extract confirmed Product price, photo, availability and SKU',()=>{
 const p=product.extract(sample,'https://shop.ru/sku/fan12');
 assert.equal(p.title,'Фанера 12 мм');
 assert.equal(p.sku,'FAN-12');
 assert.equal(p.price,1250.5);
 assert.equal(p.currency,'RUB');
 assert.equal(p.image,'https://shop.example-cdn.ru/img/fanera.jpg');
 assert.equal(p.availability,'in_stock');
 assert.equal(p.specifications['Толщина'],'12 мм');
 assert.equal(p.evidence.price,'schema.org/Offer');
 assert.equal(p.schemaConfirmed,true);
 assert.equal(p.completeness,100);
});
test('never invent missing fields or price',()=>{
 const p=product.extract('<html><head><title>Простой товар</title></head><body></body></html>','https://shop.ru/');
 assert.equal(p.price,null);assert.equal(p.image,null);assert.equal(p.sku,'');
 assert.ok(p.missing.includes('Цена')&&p.missing.includes('Фото товара'));
 assert.equal(p.schemaConfirmed,false);
});
test('price parsing respects thousands and decimal separators',()=>{
 assert.equal(product.amount('1 250,50 ₽'),1250.5);
 assert.equal(product.amount('1 250 ₽'),1250);
 assert.equal(product.amount('12,345.67'),12345.67);
 assert.equal(product.amount('0'),null);
 assert.equal(product.amount('нет цены'),null);
});
test('no price comparison without identical confirmed SKU and currency',()=>{
 const base={sku:'AB-15',price:1500,currency:'RUB'};
 assert.equal(product.comparable(base,{sku:'AB-15',price:1300,currency:'RUB'}).ok,true);
 assert.equal(product.comparable(base,{sku:'AB-20',price:1300,currency:'RUB'}).ok,false);
 assert.equal(product.comparable(base,{sku:'AB-15',price:13,currency:'USD'}).ok,false);
 assert.equal(product.comparable(base,{sku:'',price:1300,currency:'RUB'}).ok,false);
});
test('HTTPS only; reject internal domains, ports, query credentials and duplicates',async()=>{
 for(const url of ['http://site.ru/p','https://127.0.0.1','https://localhost/p',
   'https://10.0.0.1/private','https://shop.ru:444/p','https://shop.ru/p?token=123',
   'https://shop.ru/#secret','https://user:pass@shop.ru/']){
   assert.throws(()=>product.validUrl(url),url);
 }
 assert.equal(product.validUrl('https://shop.ru/p').href,'https://shop.ru/p');
 const call=(urls)=>handler({httpMethod:'POST',body:JSON.stringify({action:'compare',urls})});
 assert.equal((await call(['https://shop.ru/p'])).statusCode,422);
 assert.equal((await call(['https://shop.ru/p','https://shop.ru/p'])).statusCode,422);
 assert.equal((await call(Array(7).fill('https://shop.ru/p'))).statusCode,422);
 assert.equal((await handler({httpMethod:'GET'})).statusCode,405);
});
test('catalog shows planned features honestly and page loads analytics',()=>{
 const html=read('tools/index.html');
 assert.match(html,/id="compare-form"/);
 assert.match(html,/id="product-cards"/);
 assert.match(html,/В разработке/);
 assert.match(html,/Доступ сотрудникам/);
 assert.match(html,/assets\/mirvix-metrika\.js/);
 assert.match(html,/src="\/assets\/geo-tools\.js"/);
 assert.match(read('index.html'),/href="\/tools\/"/);
 assert.match(read('sitemap.xml'),/https:\/\/mirvixai\.com\/tools\//);
 new Script(read('assets/geo-tools.js'),{filename:'geo-tools.js'});
});
