// Description:
//   Script per fare la lista dei piatti da ordinare al TuttoBene
//
// Commands:
//   hubot menu [<menu>] - Mostra il menù. Se viene indicato anche <menu>, ne salva uno nuovo
//   hubot ordine - Lista dei piatti ordinati oggi
//   hubot email - Lista dei piatti ordinati oggi, formattata per inviare direttamente l'email
//   hubot cancella ordine - Reinizializza l'ordine corrente
//   hubot per me <ordine> [+ <ordine>] - Aggiunge <ordine> all'ordine dell'utente. Con "+ <ordine>" inserisce 2 ordini.
//   hubot per me niente - Cancella il proprio ordine
//   hubot develunch - Mostra la data del prossimo develunch
//   hubot develunch [questa|prossima] settimana - Imposta il develunch per questa o la prossima settimana. Tinabot poi in automatico lo ri-programmerà ogni 2 venerdì.
//   TB - hubot ha sempre voglia di TuttoBene!
//
// Notes:
//   <optional notes required for the script>
//
// Author:
//   nolith, tommyblue

module.exports = function (robot) {

  var moment = require('moment');
  moment.locale('it');
  var formatDate = function(date) {
    return moment(date).format('dddd D MMMM, Y');
  }

  var CronJob = require('cron').CronJob;
  var reminder_job = new CronJob('00 45 11 * * 3,4,5', function() {
      if (isDevelunch()) {
        robot.messageRoom("cibo", "oggi c'è il develunch!");
      } else {
        robot.messageRoom("cibo", "ricordatevi di ordinare entro mezzogiorno.");
      }
    }, function () {
      /* This function is executed when the job stops */
    },
    true, /* Start the job right now */
    "Europe/Rome" /* Time zone of this job. */
  );
  reminder_job.start();

  var develunch_job = new CronJob('00 00 13 * * 5', function() {
      if (isDevelunch()) {
        robot.messageRoom("cibo", "@here: *Develunch!!!111!*");

        /* schedula il prossimo */
        robot.brain.get('develunch').add(14, 'day');
      }
    }, function () {
      /* This function is executed when the job stops */
    },
    true, /* Start the job right now */
    "Europe/Rome" /* Time zone of this job. */
  );
  develunch_job.start();

  var initializeEmptyOrder = function () {
    return {
      timestamp: moment(),
      dishes: {},
      users: {},
      idToName: {},
    };
  };

  var getOrder = function (msg) {
    var order = robot.brain.get('order') || initializeEmptyOrder();

    if (typeof order.timestamp === 'string') {
      order.timestamp = moment(order.timestamp);
    }

    if (!isToday(order.timestamp)) {
      if (msg !== undefined) {
        msg.emote('Cancello l\'ordine del ' + formatDate(order.timestamp));
      }

      order = initializeEmptyOrder();
    }

    return order;
  };

  var isToday = function (dateToCheck) {
    return moment().isSame(dateToCheck, 'day');
  };

  var clearUserOrder = function (order, user) {
    var dishes = order.users[user.id];
    order.idToName[user.id] = user.name;

    for (var id in dishes) {
      var dish = dishes[id];
      if (dish !== undefined && order.dishes[dish] !== undefined) {
        var idx = order.dishes[dish].indexOf(user.id);

        if (idx > -1) {
          order.dishes[dish].splice(idx, 1);
        }

        if (order.dishes[dish].length == 0) {
          delete order.dishes[dish];
        }
      }
    }

    return dishes;
  };

  var addNewOrder = function (order, dishes, user) {
    clearUserOrder(order, user);
    for (var id in dishes) {
      var dish = dishes[id];
      var sameDish = order.dishes[dish] || [];
      sameDish.push(user.id);
      order.dishes[dish] = sameDish;
    }

    order.users[user.id] = dishes;
  };

  var fuzzyMatch = function (dish, menuline) {
    var key = dish.trim().toLowerCase().replace(" ", ".*") + ".*";

    key = new RegExp(key, "");

    menuline = menuline.trim().toLowerCase();

    return key.test(menuline);
  };

  var findDishes = function (menu, dish) {
    var matches = [];
    for (var i = 0; i < menu.length; i++) {
      if (fuzzyMatch(dish, menu[i])) {
        matches.push(menu[i]);
      }
    }

    return matches;
  };

  robot.hear(/TB/, function (msg) {
    msg.send('Se ordinate al TuttoBene posso aiutarvi io!');
  });

  robot.hear(/TuttoBene/i, function (msg) {
    msg.send('Se ordinate al TuttoBene posso aiutarvi io!');
  });

  robot.respond(/remind([\s\S]*)?/i, function (msg) {
    var state = (msg.match[1] || '').trim().toLowerCase();
    var rem = (robot.brain.get('reminder') || []);
    var usr = msg.message.user;

    if (state === '') {
      state = rem[usr] || false;
    } else if (state === 'on') {
      state = true;
    } else if (state === 'off') {
      state = false;
    } else {
      msg.reply('non capisco, puoi usare solo on/off.');
      return;
    }

    rem[usr] = state;
    msg.reply('reminder dopo pranzo: ' + (state ? 'attivato' : 'disattivato'));
    robot.brain.set('reminder', rem);
  });

  robot.respond(/develunch([\s\S]*)?/i, function (msg) {
    var when = (msg.match[1] || '').trim();

    if (when === '') {
      var develunch = robot.brain.get('develunch') || null;
      if (develunch === null) {
        msg.reply('Develunch non impostato!');
      } else {
        if (isDevelunch()) {
          msg.reply('Il develunch è oggi!');
        } else {
          msg.reply('Il develunch sarà ' + formatDate(develunch));
        }
      }
      return;
    }

    var this_week = /quest/i.test(when);
    var next_week = /prossim/i.test(when);

    var friday_offset;

    if (this_week && !next_week) {
      friday_offset = 5 - moment().day();
    } else if (next_week && !this_week) {
      friday_offset = 7 + 5 - moment().day();
    } else {
      msg.reply('non riesco a capire quando sia il develunch... prova a dirlo in un altro modo!');
      return;
    }

    if (friday_offset <= 0 && moment().isAfter(moment().day(5).hour(13).minute(00).second(00), "second")) {
      /* Caso in cui si setta il develunch per questa settimana, ma dopo le 13 di venerdì:
         mantieni il ciclo e programma fra 2 settimane */
      friday_offset += 14;
    }

    /* moment().add() tiene conto anche del cambio mese/anno, anche se friday_offset è >31 o <0 */
    next_develunch = moment().add(friday_offset, 'days');

    msg.reply('Ok, develunch impostato per ' + formatDate(next_develunch));
    robot.brain.set('develunch', next_develunch);
  });

  var isDevelunch = function() {
    var tomorrow = moment().add(1, 'days');

    return isToday(robot.brain.get('develunch') || tomorrow);
  };

  robot.respond(/per me (.*)/i, function (msg) {
    if (isDevelunch()) {
      msg.reply('Oggi c\'è il develunch, niente ordini!');
      return;
    }

    var dish = msg.match[1].trim();
    var user = msg.message.user;
    var order = getOrder(msg);

    if (dish === 'niente') {
      var oldDish = clearUserOrder(order, user);
      if (oldDish !== undefined)
        msg.reply('Ok, niente più ' + oldDish);
      else
        msg.reply('Ok, fatto!');
    } else {
      if (robot.brain.get('menu') === null) {
        msg.reply('nessun menu impostato!');
        return;
      }

      var dishes = dish.split('+');
      dishes = dishes.map(function (s) { return s.trim(); });

      // prova a fare un match fuzzy nel menu
      for (var d in dishes) {
        var newdishes = findDishes(robot.brain.get('menu').split('\n'), dishes[d])
        if (newdishes.length === 0) {
          msg.reply('mi spiace, non riesco a trovare nulla che rassomigli a "' + dishes[d] +'" nel menu.');
          return;
        } else if (newdishes.length > 1) {
          var reply = 'ho trovato diversi piatti che rassomigliano a "' + dishes[d] + '":\n';
          reply += newdishes.join('\n');
          reply += "\nprova a essere più specifico nella tua richiesta."
          msg.reply(reply);
          return;
        } else {
          dishes[d] = newdishes[0];
        }
      }

      addNewOrder(order, dishes, user);
      robot.brain.set('order', order);

      msg.reply('ok, ' + dishes.join(' e ') + ' per ' + user.name);
    }
  });

  robot.respond(/cancella ordine/i, function (msg) {
    robot.brain.set('order', initializeEmptyOrder());
    msg.reply('Ordine cancellato');
  });

  robot.respond(/ordine/i, function (msg) {
    var reply = ["Ecco l'ordine:"];
    var order = getOrder();

    for (var dish in order.dishes) {
      if (order.dishes.hasOwnProperty(dish)) {
        var userIds = order.dishes[dish];
        var line = [userIds.length, dish];

        var users = userIds.map(function (id) {
          var name = order.idToName[id];
          if (typeof name !== 'undefined' && name !== '') {
            return name;
          }
          return robot.brain.userForId(id).name;
        });

        line.push('[');
        line.push(users);
        line.push(']');

        reply.push(line.join(' '));
      }
    }

    msg.reply(reply.join('\n'));
  });

  robot.respond(/email/i, function (msg) {
    var order = getOrder();
    var reply = ["Ordine Develer del giorno " + formatDate(order.timestamp)];

    for (var dish in order.dishes) {
      if (order.dishes.hasOwnProperty(dish)) {
        var userIds = order.dishes[dish];
        var line = [userIds.length, dish];
        reply.push(line.join(' '));
      }
    }

    msg.reply(reply.join('\n'));
  });

  robot.respond(/menu([\s\S]*)?/i, function (msg) {
    var menu = (msg.match[1] || '').trim();
    if (menu === '') {
      menu = robot.brain.get('menu') || '';
      if (menu === '') {
        msg.reply('Non c\'è nessun menu impostato!');
      } else {
        msg.reply('Il menu è:\n' + menu);
      }
    } else {
      robot.brain.set('menu', menu);
      msg.reply('ok, il menu è ' + menu);
    }
  });
};
