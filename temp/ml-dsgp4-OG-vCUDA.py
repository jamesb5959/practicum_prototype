import pandas as pd
from datetime import datetime
import csv
import torch
import dsgp4
import numpy as np
import torch.nn as nn
from astropy.time import Time
from torch.nn.parameter import Parameter
from torch.utils.data import Dataset, DataLoader
from dsgp4.util import initialize_tle, propagate, propagate_batch

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

input_csv = "Satellite_62577.csv"
time_marks = []
invalid_indices = []
with open(input_csv, "r") as csv_file:
    reader = csv.DictReader(csv_file)
    start_time = None

    for i, row in enumerate(reader):
        time_str = row["publish_epoch"].strip()
        current_time = datetime.strptime(time_str, "%m/%d/%Y %H:%M")
        # Set first row as reference
        if i == 0:
            start_time = current_time
        # Compute difference in minutes
        delta = (current_time - start_time).total_seconds() / 60.0
        if delta >= 0:
          time_marks.append(float(delta))
        if delta < 0:
          invalid_indices.append(i)

tles = dsgp4.tle.load("output.tle")
valid_tles = [] 
for r in range(len(tles)):
  if r not in invalid_indices:
    valid_tles.append(tles[r])

tles = valid_tles[:850]
tm = torch.tensor(time_marks[:850])
# print(valid_tles[:10])
# print(time_marks[:10])


# ML-dSGP4 Model
class mldsgp4(nn.Module):
    def __init__(self,
                normalization_R=6958.137, 
                normalization_V=7.947155867983262, 
                hidden_size=100, 
                input_correction=1e-2, 
                output_correction=0.8,
                ):
        
        super().__init__()
        self.fc1=nn.Linear(6, hidden_size)
        self.fc2=nn.Linear(hidden_size,hidden_size)
        self.fc3=nn.Linear(hidden_size, 6)
        self.fc4=nn.Linear(6,hidden_size)
        self.fc5=nn.Linear(hidden_size, hidden_size)
        self.fc6=nn.Linear(hidden_size, 6)
        
        self.tanh = nn.Tanh()
        self.leaky_relu = nn.LeakyReLU(negative_slope=0.01)
        self.normalization_R=normalization_R
        self.normalization_V=normalization_V
        self.input_correction = Parameter(input_correction*torch.ones((6,)))
        self.output_correction = Parameter(output_correction*torch.ones((6,)))

    def forward(self, tles, tsinces):
        is_batch=hasattr(tles, '__len__')
        if is_batch:
            #this is the batch case, so we proceed and initialize the batch:
            _,tles=initialize_tle(tles,with_grad=True)
            x0 = torch.stack((tles._ecco, tles._argpo, tles._inclo, tles._mo, tles._no_kozai, tles._nodeo), dim=1)
        else:
            #this handles the case in which a single TLE is passed
            initialize_tle(tles,with_grad=True)
            x0 = torch.stack((tles._ecco, tles._argpo, tles._inclo, tles._mo, tles._no_kozai, tles._nodeo), dim=0).reshape(-1,6)

        x=self.leaky_relu(self.fc1(x0))
        x=self.leaky_relu(self.fc2(x))
        x=x0*(1+self.input_correction*self.tanh(self.fc3(x)))
        x = x.cpu()
        #now we need to substitute them back into the tles:
        tles._ecco=x[:,0]
        tles._argpo=x[:,1]
        tles._inclo=x[:,2]
        tles._mo=x[:,3]
        tles._no_kozai=x[:,4]
        tles._nodeo=x[:,5]

        # run propagation on CPU
        tsinces_cpu = tsinces.detach().cpu()

        if is_batch:    
            #we propagate the batch:
            states_teme=propagate_batch(tles,tsinces_cpu)
        else:
            states_teme=propagate(tles,tsinces_cpu)

        # move result back to GPU
        states_teme = states_teme.to(device)

        states_teme=states_teme.reshape(-1,6)
        #we now extract the output parameters to correct:
        x_out=torch.cat((states_teme[:,:3]/self.normalization_R, states_teme[:,3:]/self.normalization_V),dim=1)

        x=self.leaky_relu(self.fc4(x_out))
        x=self.leaky_relu(self.fc5(x))
        x=x_out*(1+self.output_correction*self.tanh(self.fc6(x)))
        return x


# 3. Dataset for TLE 
class TLESWDataset(Dataset):
    def __init__(self, tle_file, days):
        self.samples = []

        for t, tle in zip(tm, tles):
            # Initialize the TLE
            if isinstance(tle, list):
                _, tle_init = initialize_tle([tle])
                tle = next(iter(tle_init)) 
            else:
                _ = initialize_tle(tle, with_grad=False) # tle is already initialized
              
            state = propagate(tle, 0, initialized=True) 
            state = state.reshape(-1,6)[0]
            state[:3] = state[:3] / 6958.137
            state[3:] = state[3:] / 7.947155867983262
            self.samples.append((tles[0], t, state))

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        tle, tsince, state = self.samples[idx]
        return tle, tsince, state


def collate_fn(batch):
    tles, tsinces, states = zip(*batch)
    tsinces = torch.stack(tsinces).to(device)
    states = torch.stack(states).to(device)
    return list(tles), tsinces, states

dataset = TLESWDataset("TLE_Data.tle", days=3)
#print(len(dataset))
loader = DataLoader(dataset, batch_size=16, shuffle=True, collate_fn=collate_fn)

model = mldsgp4().to(device)
optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
criterion = nn.MSELoss()

best_loss = float("inf")
patience = 1000000
counter = 0

for epoch in range(1000):
    for tles, tsinces, targets in loader:
        preds = model(tles, tsinces)
        loss = criterion(preds, targets)
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()

    current_loss = loss.item()
    if current_loss < best_loss:
        best_loss = current_loss
        counter = 0
        torch.save(model.state_dict(), "mldsgp4_best_model.pth")
        print(f"New best model saved! Loss: {best_loss:.6f}")
    else:
        counter += 1
    print(f"Epoch: {epoch}, Loss: {current_loss:.6f}")
    # Early stopping
    if counter >= patience:
        print("Early stopping triggered")
        break