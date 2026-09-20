/**
 * client.js
 */

const util = require('util');

let variables = {};

module.exports = {
  conn: '',
  varChan: {},
  variables: {},
  init(plugin) {
    this.plugin = plugin;
    const pccc = require('nodepccc');
    this.conn = new pccc({silent:true });   
    this.addItems(this.plugin.channels.data);  
  },


  addItems(channels) {
    for (var i=0; i < channels.length; i++) {
      if (channels[i].nodename) {
        this.variables[channels[i].id] = channels[i].nodename + "," + channels[i].address;
        this.varChan[channels[i].id] = channels[i].nodename + "_" +channels[i].chan;
      } else {
        this.variables[channels[i].id] = channels[i].address;
        this.varChan[channels[i].id] = channels[i].chan;
      }
      
      
      // делаем что-нибудь с item
    }
    this.conn.setTranslationCB(tag => this.variables[tag]);  
    //this.plugin.log('Variables mapping: ' + util.inspect(variables));
    // Заполнить read pool для readAll
    this.conn.addItems(Object.keys(this.variables));
    return this.varChan;
  },

  removeItems() {
    const vars = Object.keys(this.variables);
    //console.log('Removed vars', vars);
    try {
    this.conn.removeItems(vars);
    this.varChan = {};
    this.variables = {};
  } catch (e) {
    plugin.log('ERROR onChange: ' + util.inspect(e));
  }
  },

  connect() {
    const host = this.plugin.params.data.host;
    const port = Number(this.plugin.params.data.port);

    this.plugin.log('Try connect to ' + host + ':' + port);

    // const cParam = { port, host };
    const cParam = { port, host};
   

    return new Promise((resolve, reject) => {
      this.conn.initiateConnection(cParam, err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  },

  readAll() {
    return new Promise((resolve, reject) => {
      this.conn.readAllItems((err, values) => {
        if (err) {
          reject(err);
        } else {
          resolve(values);
        }
      });
    });
  },

  write(items, values) {
    return new Promise((resolve, reject) => {
      // this.conn.writeItems(['TEST5', 'TEST6'], [ 867.5309, 9 ], valuesWritten);
      this.conn.writeItems(items, values, err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  },

  close() {
    return new Promise((resolve, reject) => {
      this.conn.dropConnection(err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
};
