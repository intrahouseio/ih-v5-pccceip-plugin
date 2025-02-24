/**
 * pccceip index.js
 */
const util = require('util');

const client = require('./client');

let nextTimer; // таймер поллинга
let waiting;   // Флаг ожидания завершения операции (содержит ts старта операции или 0)
let toWrite = []; // Массив команд на запись
let plugin;
let chanValues = {};
let channels = {};
(async () => {


  try {
    const opt = getOptFromArgs();
    const pluginapi = opt && opt.pluginapi ? opt.pluginapi : 'ih-plugin-api';
    plugin = require(pluginapi + '/index.js')();
    plugin.log('Plugin pccceip has started.', 1);

    plugin.params.data = await plugin.params.get();
    plugin.log('Received params data:' + util.inspect(plugin.params.data), 1);

    plugin.channels.data = await plugin.channels.get();
    plugin.channels.data.forEach(item => {
      channels[item.chan] = item.id;
    })
    plugin.log('Received channels data: ' + util.inspect(plugin.channels.data), 1);

    client.init(plugin);
    await client.connect();
    plugin.log('Connected!', 1);

    sendNext();
  } catch (err) {
    let res = [];
    Object.keys(channels).forEach(key => {
      res.push({ id: channels[key], chstatus: 1, chan: key });
    });
    plugin.sendData(res);
    plugin.exit(8, util.inspect(err));
  }
})();

/*  sendNext
*   Отправка на контроллер запроса на чтение или запись
* 
*    Для чтения функция запускается по таймеру nextTimer 
*    Если пришла команда на запись - таймер сбрасывается и функция вызывается напрямую
*
*    Если функция вызвана, а предыдущая операция не завершена (возможно при записи )
*     то ожидаем окончания операции (для этого взводим короткий таймер)
*/
async function sendNext() {
  if (waiting) {
    // TODO Если ожидание длится долго - сбросить флаг и выполнить следующую операцию
    nextTimer = setTimeout(sendNext, 100); // min interval?
    return;
  }

  let nextDelay = plugin.params.data.polldelay; // стандартный интервал опроса
  waiting = Date.now();
  if (toWrite.length) {
    await write();
    nextDelay = 100; // интервал - чтение после записи
  } else {
    await read();
  }
  waiting = 0;
  nextTimer = setTimeout(sendNext, nextDelay);
}

/*  read
*   Отправляет команду чтения на контроллер, ожидает результат
*   Преобразует результат и отправляет данные на сервер {id, value}
*
*   !Библиотека предоставляет только функцию readAllItems
*    "It sorts a large number of items being requested from the PLC and decides 
*     what overall data areas to request, then it groups multiple small requests 
*     together in a single packet or number of packets up to the maximum length the PLC supports, 
*     then it sends multiple packets at once, for maximum speed."
*/
async function read() {
  let res = [];
  let arr = [];
  let value;
  try {
    const data = await client.readAll();
    if (data) {
      Object.keys(data).forEach(key => {
        if (typeof chanValues[key] !== 'object') chanValues[key] = {}
        value = data[key];
        if (plugin.params.data.sendChanges) {
          if (chanValues[key].value != value) {
            res.push({ id: channels[key], value: value, chstatus: 0, chan: key });
            chanValues[key].value = value;
          }
        } else {
          res.push({ id: channels[key], value: value, chstatus: 0, chan: key });
        }
      });
      if (res.length > 0) plugin.sendData(res);
    }
  } catch (e) {
    plugin.log('Group Read error', 1);
    res = [];
    errres = [];
    for (let i = 0; i < plugin.channels.data.length; i++) {
      client.removeItems();
      client.addItems([plugin.channels.data[i]]);
      try {
        const data = await client.readAll();
        if (data) {
          Object.keys(data).forEach(key => {
            arr.push(plugin.channels.data[i]);
            res.push({ id: channels[key], value: data[key], chstatus: 0, chan: key });
          });
        }
      } catch (e) {
        plugin.log('Read error: ' + util.inspect(plugin.channels.data[i].chan), 0);
        errres.push({ id: plugin.channels.data[i].id, chstatus: 1, chan: plugin.channels.data[i].chan });
      }
    }
    if (res.length > 0) plugin.sendData(res);
    if (errres.length > 0) plugin.sendData(errres);
    if (errres.length == plugin.channels.data.length) plugin.exit(2, 'All ' + plugin.channels.data.length + ' tags are unavailable');
    client.removeItems();
    client.addItems(arr);
  }
}
/*  write
*   Отправляет команду записи на контроллер и ожидает завершения 
*   Данные для отправки находятся в массиве toWrite = [{id, value}]
*   (возможно накопление нескольких команд при ожидании окончания предыдущей операции)
*
*  Перед отправкой данные разделяются на массивы items = ['TEST1','TEST2'] и values = [42,1] 
*   так как функция библиотеки writeItems(items, values) принимает 2 массива:
*   "Writes items to the PLC using the corresponding values"
 
*  Массив toWrite очищается
*/
async function write() {
  try {
    const items = [];
    const values = [];
    toWrite.forEach(item => {
      items.push(item.id);
      values.push(item.value);
    });
    toWrite = [];
    if (items.length > 0 && values.length > 0) {
      await client.write(items, values);
      plugin.log('Write completed' + items + " " + values, 1);
    }

  } catch (e) {
    plugin.log('Write ERROR: ' + util.inspect(e), 1);
  }
}

function getOptFromArgs() {
  let opt;
  try {
    opt = JSON.parse(process.argv[2]); //
  } catch (e) {
    opt = {};
  }
  return opt;
}


// Сообщения от сервера
/**  act
 * Получили от сервера команду(ы) для устройства - пытаться отправить на контроллер
 *
 * @param {Array of Objects} - message.data - массив команд
 */
plugin.onAct(message => {
  //console.log('Write recieve', message);
  plugin.log('ACT data=' + util.inspect(message.data), 1);

  if (!message.data) return;
  message.data.forEach(item => {
    toWrite.push({ id: item.chan, value: item.value });
  });
  // Попытаться отправить на контроллер
  // Сбросить таймер поллинга, чтобы не случилось наложения
  clearTimeout(nextTimer);
  sendNext();
});

plugin.channels.onChange(async function () {
  try {
    clearTimeout(nextTimer);
    client.removeItems();
    plugin.channels.data = await plugin.channels.get();
    channels = {};
    plugin.channels.data.forEach(item => {
      channels[item.chan] = item.id;
    })
    client.addItems(plugin.channels.data);
    chanValues = {};
    sendNext();
  } catch (e) {
    plugin.log('ERROR onChange: ' + util.inspect(e), 1);
  }

});

// Завершение работы
function terminate() {
  client.close();
}

process.on('exit', terminate);
process.on('SIGTERM', () => {
  process.exit(0);
});
