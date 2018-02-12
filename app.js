(() => {
  const CLIENT_ID = '575891048672-7em6n115tqq4i4kbj5hgijltctpkrkmh.apps.googleusercontent.com';
  const API_KEY = 'AIzaSyCDQdm45POgt3JJ3jccBXnMR0zILnufRsg';

  const DISCOVERY_DOCS = ["https://sheets.googleapis.com/$discovery/rest?version=v4"];

  const SCOPES = "https://www.googleapis.com/auth/spreadsheets";

  // Indexes for the spreadsheet's sheet
  const TRANSACTIONS_INDEX = 0;
  const TOTALS_INDEX = 1;

  // Community identifier in the spreadsheet
  const COMMUNITY_USER = 'Community';

  const getNowDate = () => {
    const now = new Date();

    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() > 9 ? (now.getUTCMonth() + 1) : `0${(now.getUTCMonth() + 1)}`;
    const day = now.getUTCDate() > 9 ? now.getUTCDate() : `0${now.getUTCDate()}`;
    const hour = now.getUTCHours() > 9 ? now.getUTCHours() : `0${now.getUTCHours()}`;
    const minute = now.getUTCMinutes() > 9 ? now.getUTCMinutes() : `0${now.getUTCMinutes()}`;

    return `${year}/${month}/${day} ${hour}:${minute}`;
  };

  const createUserTotal = (app, googleSheets, totalsRowsLength) => {
    // Format === ["USER", "BALANCE", "STATUS"]
    const newRow = totalsRowsLength + 1;

    const balanceFormula = `=SUMIF(Transactions!D:D,A${newRow},Transactions!C:C) - SUMIF(Transactions!B:B,A${newRow},Transactions!C:C)`;

    const values = [ app.currentUser, balanceFormula, 'Active' ];

    return new Promise((resolve, reject) => {
      return googleSheets.append({
        spreadsheetId: app.spreadsheetId,
        range: `Totals!A${newRow}:C${newRow}`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [ values ],
        },
      })
      .then((response) => {
        if (!response || !response.result || !response.result.updates || !response.result.updates.updatedCells) {
          app.$notify({
            title: 'Oh no!',
            message: 'Error registering user totals! Please logout and sign in again.',
            type: 'error',
          });
        }

        return resolve();
      }, reject);
    });
  };

  const createUserTransaction = (app, googleSheets, transactionsRowsLength, fromUser, toUser, credits) => {
    // Format === ["DATETIME", "USER_TO", "VALUE", "USER_FROM"]
    const newRow = transactionsRowsLength + 1;

    const values = [ getNowDate(), toUser, credits, fromUser ];

    return new Promise((resolve, reject) => {
      return googleSheets.append({
        spreadsheetId: app.spreadsheetId,
        range: `Transactions!A${newRow}:D${newRow}`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [ values ],
        },
      })
      .then((response) => {
        if (!response || !response.result || !response.result.updates || !response.result.updates.updatedCells) {
          app.$notify({
            title: 'Oh no!',
            message: 'Error registering user transaction! Please logout and sign in again.',
            type: 'error',
          });
        }

        return resolve();
      }, reject);
    });
  };

  // Create all the necessary rows in the sheets to add a new user
  const createUser = (app, googleSheets, totalsRowsLength, transactionsRows, transactionsRowsLength) => {
    app.currentBalance = 0;

    return Promise.all([
        createUserTotal(app, googleSheets, totalsRowsLength),
        createUserTransaction(app, googleSheets, transactionsRowsLength, COMMUNITY_USER, app.currentUser, 0),
      ])
      .then(() => {
        return Promise.resolve(transactionsRows);
      });
  };

  const makeUserInactive = (app, googleSheets, userToUpdate) => {
    // Format === ["USER", "BALANCE", "STATUS"]
    // Find user index
    let userIndex = -1;

    app.users.forEach((user, index) => {
      if (user.email === userToUpdate) {
        userIndex = index;
      }
    });

    if (userIndex === -1) {
      return Promise.reject('Unable to find user');
    }

    // We need to account for the header and community rows
    userIndex += 2;

    const balanceFormula = `=SUMIF(Transactions!D:D,A${userIndex},Transactions!C:C) - SUMIF(Transactions!B:B,A${userIndex},Transactions!C:C)`;

    const values = [ app.currentUser, balanceFormula, 'Inactive' ];

    return new Promise((resolve, reject) => {
      return googleSheets.update({
        spreadsheetId: app.spreadsheetId,
        range: `Totals!A${userIndex}:C${userIndex}`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [ values ],
        },
      })
      .then((response) => {
        if (!response || !response.result || !response.result.updatedCells) {
          app.$notify({
            title: 'Oh no!',
            message: 'Error updating user status! Please logout and sign in again.',
            type: 'error',
          });
        }

        return resolve();
      }, reject);
    });
  };

  // Compute & create all the necessary rows in the sheets to delete a user
  const deleteUser = (app, googleSheets, transactionsRowsLength) => {
    const transactionPromises = [];

    // Calculate how much will need to be split per user
    const credits = app.currentBalance;
    const destinationUsers = app.destinations(app.users);
    const totalUsers = destinationUsers.length;

    const perUser = Math.ceil(Math.abs(credits) / totalUsers) * Math.sign(credits);

    // Add first transaction from Community
    const communityTransactionPromise = createUserTransaction(app, googleSheets, transactionsRowsLength++, COMMUNITY_USER, app.currentUser, credits);

    transactionPromises.push(communityTransactionPromise);

    // Add a transaction per user to balance out the community balance
    destinationUsers.forEach((user) => {
      const transactionPromise = createUserTransaction(app, googleSheets, transactionsRowsLength++, user.email, COMMUNITY_USER, perUser);

      transactionPromises.push(transactionPromise);
    });

    // Update the user status to inactive
    const statusUpdatePromise = makeUserInactive(app, googleSheets, app.currentUser);
    transactionPromises.push(statusUpdatePromise);

    return Promise.all(transactionPromises)
      .then(() => {
        return Promise.resolve();
      });
  };

  const app = new Vue({
    el: '#app',
    data: {
      isLoading: true,
      signedIn: false,
      currentUser: '',
      validSpreadsheet: false,
      sendCreditsVisible: false,
      inactiveUsersVisible: false,
      spreadsheetUrl: '',
      spreadsheetId: '',
      credits: 0,
      destination: '',
      currentBalance: 0,
      communityBalance: 0,
      transactions: [],
      userTransactions: [],
      users: [],
    },
    created: () => {
      gapi.load('client:auth2', () => {
        gapi.client.init({
          apiKey: API_KEY,
          clientId: CLIENT_ID,
          discoveryDocs: DISCOVERY_DOCS,
          scope: SCOPES,
        })
        .then(() => {
          app.isLoading = false;

          if (gapi.auth2.getAuthInstance().isSignedIn.get()) {
            app.signIn();
          }
        });
      });
    },
    methods: {
      signIn: () => {
        gapi.auth2.getAuthInstance().signIn()
          .then((googleUser) => {
            app.signedIn = true;

            app.currentUser = googleUser.getBasicProfile().getEmail();

            app.$notify({
              title: 'Alright!',
              message: 'Signed in successfully!',
              type: 'success',
              duration: 1500,
            });
          }, (error) => {
            if (error.error != 'popup_blocked_by_browser') {
              app.$notify({
                title: 'Oh no!',
                message: `Error signing in: "${error.error}"!`,
                type: 'error',
              });
            }
          });
      },
      signOut: () => {
        gapi.auth2.getAuthInstance().signOut()
          .then(() => {
            app.signedIn = false;
            app.currentUser = '';
            app.currentBalance = 0;
            app.communityBalance = 0;
            app.transactions.length = 0;// Empty array without removing reference
            app.userTransactions.length = 0;// Empty array without removing reference
            app.users.length = 0;// Empty array without removing reference
            app.validSpreadsheet = false;
            app.spreadsheetUrl = '';
            app.spreadsheetId = '';
          });
      },
      validateSpreadsheet: function() {
        const matches = new RegExp('/spreadsheets/d/([a-zA-Z0-9-_]+)').exec(this.spreadsheetUrl);

        if (!matches || matches.length !== 2) {
          this.$notify({
            title: 'Oh no!',
            message: 'Invalid URL! Make sure it starts with "https://docs.google.com/spreadsheets/d/" (no quotes).',
            type: 'error',
          });
        } else {
          this.validSpreadsheet = true;
          this.spreadsheetId = matches[1];

          this.$notify({
            title: 'Alright!',
            message: 'Valid spreadsheet!',
            type: 'success',
            duration: 1500,
          });

          this.showData();
        }
      },
      destinations: (users) => users.filter((user) => (user.status === 'Active' && user.email !== app.currentUser && user.email !== COMMUNITY_USER)),
      active: (users) => users.filter((user) => (user.status === 'Active')),
      inactive: (users) => users.filter((user) => (user.status === 'Inactive')),
      showData: () => {
        const googleSheets = gapi.client.sheets.spreadsheets.values;

        app.isLoading = true;

        // Clear users, transactions, and balances
        app.currentBalance = 0;
        app.communityBalance = 0;
        app.transactions.length = 0;// Empty array without removing reference
        app.userTransactions.length = 0;// Empty array without removing reference
        app.users.length = 0;// Empty array without removing reference

        googleSheets.batchGet({
          spreadsheetId: app.spreadsheetId,
          ranges: ['Transactions!A:D', 'Totals!A:E'],
        })
        .then((response) => {
          const result = response.result;

          if (result.valueRanges.length !== 2) {
            app.$notify({
              title: 'Oh no!',
              message: 'Invalid spreadsheet format!',
              type: 'error',
            });

            return Promise.reject('Nope');
          }

          const totalsRows = result.valueRanges[TOTALS_INDEX].values;
          const totalsRowsLength = totalsRows.length;

          const transactionsRows = result.valueRanges[TRANSACTIONS_INDEX].values;
          const transactionsRowsLength = transactionsRows.length;

          // Confirm data format is as expected (totalsRows)
          if (totalsRowsLength < 2
            || totalsRows[0].length !== 5
            || totalsRows[0][0] !== 'User'
            || totalsRows[0][1] !== 'Total'
            || totalsRows[0][2] !== 'Status'
            || totalsRows[0][3] !== ''
            || totalsRows[0][4] !== 'VALID IF 0'
            || totalsRows[1].length !== 5
            || totalsRows[1][0] !== COMMUNITY_USER
            || parseInt(totalsRows[1][1], 10) < 0
            || totalsRows[1][2] !== 'Active'
            || totalsRows[1][3] !== ''
            || totalsRows[1][4] !== '0') {
            app.$notify({
              title: 'Oh no!',
              message: 'Invalid spreadsheet format (Totals)!',
              type: 'error',
            });

            return Promise.reject();
          }

          // Confirm data format is as expected (transactionsRows)
          if (transactionsRowsLength < 1
            || transactionsRows[0].length !== 4
            || transactionsRows[0][0] !== 'Date'
            || transactionsRows[0][1] !== 'User'
            || transactionsRows[0][2] !== 'In'
            || transactionsRows[0][3] !== 'From') {
            app.$notify({
              title: 'Oh no!',
              message: 'Invalid spreadsheet format (Transactions)!',
              type: 'error',
            });

            return Promise.reject();
          }

          let foundCurrentUser = false;

          // Get all users
          totalsRows.forEach((row, rowIndex) => {
            if (rowIndex === 0) return;// Header row

            const user = {
              email: row[0],
              total: parseInt(row[1], 10),
              status: row[2],
            };

            if (user.email === COMMUNITY_USER) {
              app.communityBalance = user.total;
            }

            if (user.email === app.currentUser) {
              foundCurrentUser = true;
              app.currentBalance = user.total;
            }

            app.users.push(user);
          });

          // If the current user is not found, create user and transactions
          if (!foundCurrentUser) {
            return createUser(app, googleSheets, totalsRowsLength, transactionsRows, transactionsRowsLength);
          }

          return Promise.resolve(transactionsRows);
        }, (response) => {
          const error = response.result.error.message;

          app.isLoading = false;

          app.$notify({
            title: 'Oh no!',
            message: `Error fetching sheet values: "${error}"!`,
            type: 'error',
          });
        })
        .then((transactionsRows) => {
          // Get all related transactions
          transactionsRows.forEach((row, rowIndex) => {
            if (rowIndex === 0) return;// Header row

            const transaction = {
              date: row[0],
              user: row[1],
              in: parseInt(row[2], 10),
              from: row[3],
            };

            app.transactions.push(transaction);

            if (row[1] === app.currentUser || row[3] === app.currentUser) {
              app.userTransactions.push(transaction);
            }
          });

          // Find the last transaction for each inactive user (their cost)
          app.inactive(app.users).forEach((inactiveUser) => {
            app.transactions.forEach((transaction) => {
              if (transaction.user === inactiveUser.email && transaction.from === COMMUNITY_USER && transaction.in !== 0) {
                inactiveUser.total = transaction.in;
              }
            });
          });

          app.isLoading = false;
        });
      },
      sendCredits: () => {
        if (app.credits < 1 || !app.destination) {
          app.$notify({
            title: 'Oh no!',
            message: 'You need to define a number of credits and someone to send them to.',
            type: 'error',
            duration: 1500,
          });

          return false;
        }

        const googleSheets = gapi.client.sheets.spreadsheets.values;

        app.$confirm(
          `Are you sure you want to send ${app.credits} credits to ${app.destination}?`,
          'Are you sure?',
          {
            confirmButtonText: 'Yes',
            cancelButtonText: 'Not Really',
            type: 'warning',
          }
        )
        .then(() => {
          app.isLoading = true;
        })
        .then(() => createUserTransaction(app, googleSheets, (app.transactions.length + 1), app.currentUser, app.destination, app.credits * -1))
        .then(() => {
          app.isLoading = false;

          app.$notify({
            title: 'Alright!',
            message: `${app.credits} credits sent to ${app.destination}!`,
            type: 'success',
          });

          app.sendCreditsVisible = false;
          app.credits = 0;
          app.destination = '';

          // Refresh data
          app.showData();
        })
        .catch((error) => {
          if (error !== 'cancel') {
            app.$notify({
              title: 'Oh no!',
              message: `Error sending credits: "${error}"!`,
              type: 'error',
            });
          }
        });
      },
      deleteAccount: () => {
        const googleSheets = gapi.client.sheets.spreadsheets.values;

        app.$confirm(
          'Are you sure you want to delete your account?<br /><br />Your balance (even if negative) will be split amongst the community.',
          'Are you sure?',
          {
            confirmButtonText: 'Yes',
            cancelButtonText: 'Not Really',
            type: 'danger',
            dangerouslyUseHTMLString: true,
          }
        )
        .then(() => {
          app.isLoading = true;
        })
        .then(() => deleteUser(app, googleSheets, (app.transactions.length + 1)))
        .then(() => {
          app.isLoading = false;

          app.$notify({
            title: 'Alright!',
            message: 'Account deleted!',
            type: 'success',
          });

          app.signOut();
        })
        .catch((error) => {
          if (error !== 'cancel') {
            app.$notify({
              title: 'Oh no!',
              message: `Error deleting account: "${error}"!`,
              type: 'error',
            });
          }
        });
      },
    },
  });
})();
