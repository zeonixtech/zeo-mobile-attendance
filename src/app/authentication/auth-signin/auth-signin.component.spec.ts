import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';

import { AuthSigninComponent } from './auth-signin.component';

describe('AuthSigninComponent', () => {
  let component: AuthSigninComponent;
  let fixture: ComponentFixture<AuthSigninComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ AuthSigninComponent ],
      imports: [
        IonicModule.forRoot(),
        FormsModule,
        RouterTestingModule
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AuthSigninComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
